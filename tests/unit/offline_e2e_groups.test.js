import fs from "node:fs";
import path from "node:path";
import { OFFLINE_E2E_GROUPS, groupArguments, offlineGroupForFile } from "../../scripts/run-offline-e2e-group.mjs";

const dir = path.resolve(__dirname, "../e2e/offline");
const files = fs.readdirSync(dir, { recursive: true })
  .filter((file) => file.endsWith(".spec.js"))
  .map((file) => `tests/e2e/offline/${file}`);

describe("ordinary offline CI scopes", () => {
  test("every current spec is selected by exactly one scope's escaped file filter", () => {
    const filters = Object.keys(OFFLINE_E2E_GROUPS).map((group) =>
      new RegExp(groupArguments(group, files).at(-1)));
    for (const file of files) {
      expect(filters.filter((filter) => filter.test(file)), file).toHaveLength(1);
      expect(filters.filter((filter) => filter.test(file.replaceAll("/", "\\"))), file).toHaveLength(1);
    }
  });

  test("new specs inherit their scope without maintaining a static file allowlist", () => {
    expect(offlineGroupForFile("new_feature.offline.spec.js")).toBe("desktop");
    expect(offlineGroupForFile("mobile_new_control.offline.spec.js")).toBe("mobile-ui");
    expect(offlineGroupForFile("mobile_stack_new_route.offline.spec.js")).toBe("mobile-stack");
    expect(offlineGroupForFile("tests/e2e/offline/nested/mobile_feature.offline.spec.js")).toBe("desktop");
    expect(offlineGroupForFile("tests\\e2e\\offline\\mobile_stack_feature.offline.spec.js")).toBe("mobile-stack");
    expect(offlineGroupForFile("helpers.js")).toBeNull();
  });

  test("desktop retains Firefox selection coverage, mobile scopes retain real mobile settings", () => {
    expect(groupArguments("desktop", files).filter((arg) => arg.startsWith("--project=")))
      .toEqual(["--project=offline", "--project=offline-firefox"]);
    for (const group of ["mobile-ui", "mobile-stack"]) {
      expect(groupArguments(group, files)[0]).toBe("--project=offline-mobile");
    }
  });

  test("unknown and empty scopes fail instead of silently passing with no tests", () => {
    expect(() => groupArguments("typo", files)).toThrow(/Unknown offline group/);
    expect(() => groupArguments("mobile-stack", ["plain.offline.spec.js"])).toThrow(/Empty offline group/);
  });

  test("file filters exclude suffixes and treat regex metacharacters literally", () => {
    const file = "tests/e2e/offline/feature.v2.offline.spec.js";
    const filter = new RegExp(groupArguments("desktop", [file]).at(-1));
    expect(filter.test(file)).toBe(true);
    expect(filter.test(file + ".bak")).toBe(false);
    expect(filter.test(file.replace("feature.v2", "featureXv2"))).toBe(false);
  });
});
