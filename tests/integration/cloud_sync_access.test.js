import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithCredential
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  setDoc,
  terminate
} from "firebase/firestore";
import { FIREBASE_CONFIG } from "../../src/js/firebase_config";

const projectId = process.env.GCLOUD_PROJECT;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let sequence = 0;
let clients;

beforeEach(() => {
  if (!projectId.startsWith("demo-")) {
    throw new Error("Access tests require a demo Firebase project.");
  }
  clients = [];
});

afterEach(() =>
  Promise.all(clients.map(client =>
    terminate(client.db).then(() => deleteApp(client.app))
  ))
);

const createClient = async (mode = "google") => {
  sequence += 1;
  const name = "access-" + Date.now().toString(36) + "-" + sequence;
  const app = initializeApp({ ...FIREBASE_CONFIG, projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://" + authHost, { disableWarnings: true });
  const db = getFirestore(app);
  const [host, port] = firestoreHost.split(":");
  connectFirestoreEmulator(db, host, Number(port));
  const client = { app, auth, db, user: null };
  clients.push(client);
  if (mode === "google") {
    const credential = await signInWithCredential(auth,
      GoogleAuthProvider.credential(JSON.stringify({
        sub: name,
        email: name + "@example.com",
        email_verified: true
      }))
    );
    client.user = credential.user;
  } else if (mode === "anonymous") {
    client.user = (await signInAnonymously(auth)).user;
  }
  return client;
};

const setClaims = async (client, claims) => {
  const response = await fetch(
    "http://" + authHost + "/identitytoolkit.googleapis.com/v1/projects/" +
      projectId + "/accounts:update",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        localId: client.user.uid,
        customAttributes: JSON.stringify(claims)
      })
    }
  );
  expect(response.status).toBe(200);
  await client.user.getIdToken(true);
};

const expectDenied = async promise => {
  await expect(promise).rejects.toMatchObject({ code: "permission-denied" });
};

test.each(["signed-out", "anonymous", "google"])(
  "%s clients cannot read or write preferences without an administrator grant",
  async mode => {
    const client = await createClient(mode);
    const reference = doc(client.db, "users", client.user?.uid || "unowned");
    await expectDenied(getDocFromServer(reference));
    await expectDenied(setDoc(reference, { prefs: { fontSize: 20 } }));
  }
);

test("a granted account can sync its own preferences but cannot access another account", async () => {
  const owner = await createClient();
  const other = await createClient();
  await setClaims(owner, { cloudSync: true });
  const ownReference = doc(owner.db, "users", owner.user.uid);
  await setDoc(ownReference, { prefs: { fontSize: 21 } });
  expect((await getDocFromServer(ownReference)).data()).toEqual({
    prefs: { fontSize: 21 }
  });
  const otherReference = doc(owner.db, "users", other.user.uid);
  await expectDenied(getDocFromServer(otherReference));
  await expectDenied(setDoc(otherReference, { prefs: { fontSize: 99 } }));
});

test.each([false, "true"])("a cloudSync claim of %s does not grant access", async value => {
  const client = await createClient();
  await setClaims(client, { cloudSync: value });
  const reference = doc(client.db, "users", client.user.uid);
  await expectDenied(getDocFromServer(reference));
  await expectDenied(setDoc(reference, { prefs: { fontSize: 20 } }));
});

test("a normal client cannot grant itself a custom claim", async () => {
  const client = await createClient();
  const response = await fetch(
    "http://" + authHost +
      "/identitytoolkit.googleapis.com/v1/accounts:update?key=emulator-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: await client.user.getIdToken(),
        customAttributes: JSON.stringify({ cloudSync: true })
      })
    }
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.message).toContain("INSUFFICIENT_PERMISSION");
  expect((await client.user.getIdTokenResult(true)).claims.cloudSync).toBeUndefined();
  await expectDenied(setDoc(doc(client.db, "users", client.user.uid), {
    prefs: { fontSize: 20 }
  }));
});

test("preference data cannot grant cloud access", async () => {
  const client = await createClient();
  await expectDenied(setDoc(doc(client.db, "users", client.user.uid), {
    cloudSync: true,
    prefs: { cloudSync: true, fontSize: 20 }
  }));
  expect((await client.user.getIdTokenResult()).claims.cloudSync).toBeUndefined();
});
