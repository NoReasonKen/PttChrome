// @unit-env browser
// real-input: tests/e2e/offline/mobile_pixiv_lookup.offline.spec.js
import { act, render, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import PixivLookup from "../../src/components/PixivLookup";
import * as lookup from "../../src/js/pixiv_lookup";
import { i18n, setupI18n } from "../../src/js/i18n";

vi.mock("../../src/js/pixiv_lookup", { spy: true });

const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let calls;

beforeAll(() => setupI18n());
beforeEach(() => {
  calls = [];
  lookup.startPixivLookup.mockImplementation((query, emit) => {
    const call = { query, emit, cancel: vi.fn() };
    calls.push(call);
    return call.cancel;
  });
});

function makeCore() {
  const release = vi.fn();
  return { setModalOpen: vi.fn(), registerSheetDismiss: vi.fn(() => release), release };
}

function mount(props = {}) {
  const core = props.core || makeCore();
  const onClose = props.onClose || vi.fn();
  const element = (query) => (
    <MantineProvider forceColorScheme="dark">
      <PixivLookup core={core} query={query} onClose={onClose} mobile={props.mobile} />
    </MantineProvider>
  );
  const rendered = render(element(props.query === undefined ? "65964428" : props.query));
  return { ...rendered, core, onClose, changeQuery: (query) => rendered.rerender(element(query)) };
}

function reply(result, index = calls.length - 1) {
  act(() => calls[index].emit({ query: calls[index].query, ...result }));
}

const card = (kind) => document.querySelector(`[data-pixiv-kind="${kind}"]`);

test("a closed or invalid query does not query Pixiv or claim a modal", () => {
  const { core, changeQuery } = mount({ query: null });
  expect(calls).toHaveLength(0);
  changeQuery("https://example.com/");
  expect(calls).toHaveLength(0);
  expect(core.setModalOpen).not.toHaveBeenCalledWith("pixivLookup", true);
});

test("metadata makes a found page usable while its image and the other type are pending", () => {
  mount();
  reply({ kind: "user", state: "found", name: "Artist", description: "A biography", imagePending: true });
  const link = card("user").querySelector("a");
  expect(link.href).toBe("https://www.pixiv.net/users/65964428");
  expect(link.target).toBe("_blank");
  expect(card("user").querySelector('[data-pixiv-image-state="loading"]')).not.toBeNull();
  expect(card("artwork").dataset.pixivState).toBe("loading");
  reply({ kind: "user", state: "found", name: "Artist", description: "A biography", image: IMAGE });
  expect(card("user").querySelector("a")).toBe(link);
  expect(card("user").querySelector("img").src).toBe(IMAGE);
});

test("a confirmed missing type is hidden without removing a found page whose image failed", () => {
  mount();
  reply({ kind: "user", state: "missing" });
  reply({ kind: "artwork", state: "found", name: "Artwork", author: "Artist", imageError: true });
  expect(card("user")).toBeNull();
  expect(card("artwork").textContent).toContain(i18n("pixiv_image_unavailable"));
  expect(card("artwork").querySelector("a").href).toBe("https://www.pixiv.net/artworks/65964428");
  expect(document.querySelector("[data-pixiv-empty]")).toBeNull();
});

test.each(['r18', 'r18g', 'restricted'])("an unavailable image explains its %s restriction and keeps the page link", (restriction) => {
  mount();
  reply({ kind: 'user', state: 'missing' });
  reply({ kind: 'artwork', state: 'found', name: 'Restricted artwork', restriction, imageError: true });
  expect(card('artwork').textContent).toContain(i18n('pixiv_' + restriction));
  expect(card('artwork').textContent).not.toContain(i18n('pixiv_image_unavailable'));
  expect(card('artwork').querySelector('a')).not.toBeNull();
});

test('upstream messages are plain text for image and lookup failures instead of hidden missing results', () => {
  mount();
  const message = '<script>not executed</script> Sign in to view this page.';
  reply({ kind: 'user', state: 'unavailable', message });
  reply({ kind: 'artwork', state: 'found', name: 'Artwork', message, imageError: true });
  for (const kind of ['user', 'artwork']) {
    expect(card(kind).textContent).toContain(message);
    expect(card(kind).querySelector('script')).toBeNull();
  }
  expect(document.querySelector('[data-pixiv-empty]')).toBeNull();
});

test.each(["user", "artwork"])("hiding missing %s retains the other loading or unavailable type at full width", (missingKind) => {
  mount();
  const remainingKind = missingKind === "user" ? "artwork" : "user";
  reply({ kind: missingKind, state: "missing" });
  expect(card(missingKind)).toBeNull();
  expect(card(remainingKind).dataset.pixivState).toBe("loading");
  expect(card(remainingKind).textContent).toContain(i18n("pixiv_loading"));
  expect(document.querySelector("[data-pixiv-empty]")).toBeNull();
  const grid = document.querySelector(".PixivLookup__Cards");
  expect(Math.abs(card(remainingKind).getBoundingClientRect().width - grid.getBoundingClientRect().width)).toBeLessThan(1);
  reply({ kind: remainingKind, state: "unavailable" });
  expect(card(remainingKind).textContent).toContain(i18n("pixiv_unavailable"));
  expect(card(remainingKind).querySelector("a")).toBeNull();
  expect(document.querySelector("[data-pixiv-empty]")).toBeNull();
});

test.each([false, true])("both missing types show one empty message on mobile %s, then a new query starts cleanly", (mobile) => {
  const { changeQuery } = mount({ mobile });
  reply({ kind: "user", state: "missing" });
  reply({ kind: "artwork", state: "missing" });
  expect(card("user")).toBeNull();
  expect(card("artwork")).toBeNull();
  expect(document.querySelector(".PixivLookup__Cards")).toBeNull();
  const empty = document.querySelectorAll("[data-pixiv-empty]");
  expect(empty).toHaveLength(1);
  expect(empty[0].textContent).toBe(i18n("pixiv_no_results"));
  expect(document.querySelector(".PixivLookup").querySelector("a")).toBeNull();
  changeQuery("117918634");
  expect(document.querySelector("[data-pixiv-empty]")).toBeNull();
  expect(card("user").dataset.pixivState).toBe("loading");
  expect(card("artwork").dataset.pixivState).toBe("loading");
});

test("a fast image decode failure is retained without hiding the found page", async () => {
  mount();
  reply({ kind: "artwork", state: "found", name: "Corrupt image", image: "data:image/png;base64,YmFk" });
  await waitFor(() => expect(card("artwork").querySelector('[data-pixiv-image-state="unavailable"]')).not.toBeNull());
  expect(card("artwork").querySelector("a").href).toBe("https://www.pixiv.net/artworks/65964428");
  reply({ kind: "artwork", state: "found", name: "Valid image", image: IMAGE });
  await waitFor(() => expect(card("artwork").querySelector("img")?.src).toBe(IMAGE));
});

test("descriptions are plain text and long titles, authors and descriptions are clamped", () => {
  mount();
  reply({ kind: "artwork", state: "found", name: "Artwork ".repeat(90), author: "Artist ".repeat(90), description: "<script>untrusted</script>\n" + "A long description ".repeat(150), width: 383, height: 540, image: IMAGE });
  const result = card("artwork");
  expect(result.querySelector("script")).toBeNull();
  expect(result.querySelector(".PixivLookupCard__Description").textContent).toContain("<script>untrusted</script>\n");
  for (const [selector, lines] of [["Name", "2"], ["Author", "1"], ["Description", "3"]]) {
    expect(getComputedStyle(result.querySelector(`.PixivLookupCard__${selector}`)).webkitLineClamp).toBe(lines);
  }
  expect(getComputedStyle(result.querySelector("img")).objectFit).toBe("contain");
});

test.each([false, true])('the compact %s mobile popup links its headings and has no close button', (mobile) => {
  mount({ mobile });
  const description = 'Short first.\n\nShort third.\n\n' + 'A continuous description '.repeat(30);
  reply({ kind: 'user', state: 'found', name: 'User name', description });
  reply({ kind: 'artwork', state: 'found', name: 'Artwork title', author: 'Artist', description });
  for (const kind of ['user', 'artwork']) {
    const result = card(kind);
    const name = result.querySelector('.PixivLookupCard__Name');
    const text = result.querySelector('.PixivLookupCard__Description');
    expect(name.closest('a').href).toBe(lookup.pixivPageUrl(kind, '65964428'));
    expect(getComputedStyle(name).fontSize).toBe('17px');
    expect(getComputedStyle(text).fontSize).toBe('12px');
    expect(getComputedStyle(text).whiteSpace).toBe('normal');
    expect(text.textContent).toBe(description);
    expect(getComputedStyle(result).padding).toBe('4px 6px');
  }
  expect(document.querySelector('.PixivLookupCard__Open')).toBeNull();
  expect(document.querySelector('[role="dialog"] button')).toBeNull();
});

test.each([false, true])('the %s mobile popup and a tall proportional image respect viewport height limits', async (mobile) => {
  mount({ mobile });
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 1800;
  reply({ kind: 'user', state: 'missing' });
  reply({ kind: 'artwork', state: 'found', name: 'Tall artwork', image: canvas.toDataURL(), width: 300, height: 1800 });
  const image = card('artwork').querySelector('img');
  await waitFor(() => expect(image.naturalHeight).toBe(1800));
  const box = image.getBoundingClientRect();
  expect(box.height).toBeGreaterThan(0);
  expect(box.height).toBeLessThanOrEqual(innerHeight * 0.5 + 1);
  expect(box.width / box.height).toBeCloseTo(1 / 6, 2);
  const popup = document.querySelector(mobile ? '[data-sheet="pixivLookup"]' : '.PixivLookupModal');
  expect(popup.getBoundingClientRect().height).toBeLessThanOrEqual(innerHeight * 0.75 + 1);
});

test("replacing or dismissing a query cancels work and ignores late replies", () => {
  const { changeQuery, unmount } = mount();
  reply({ kind: "user", state: "found", name: "Old user" });
  changeQuery("117918634");
  expect(calls[0].cancel).toHaveBeenCalledTimes(1);
  expect(card("user").textContent).not.toContain("Old user");
  reply({ kind: "user", state: "found", name: "Late old user" }, 0);
  expect(card("user").textContent).not.toContain("Late old user");
  reply({ kind: "artwork", query: "65964428", state: "found", name: "Mismatched query" });
  expect(card("artwork").textContent).not.toContain("Mismatched query");
  changeQuery(null);
  expect(calls[1].cancel).toHaveBeenCalledTimes(1);
  unmount();
  expect(calls[1].cancel).toHaveBeenCalledTimes(1);
});

test.each([false, true])("the %s mobile surface registers a single dismiss handler until close", async (mobile) => {
  const { core, onClose, changeQuery, unmount } = mount({ mobile });
  await waitFor(() => expect(core.registerSheetDismiss).toHaveBeenCalledTimes(1));
  expect(core.setModalOpen.mock.calls.some(([, open]) => open === true)).toBe(true);
  const dismiss = core.registerSheetDismiss.mock.calls[0][0];
  act(() => dismiss());
  expect(onClose).toHaveBeenCalledTimes(1);
  reply({ kind: "user", state: "found", name: "Artist" });
  expect(core.registerSheetDismiss).toHaveBeenCalledTimes(1);
  changeQuery(null);
  expect(core.release).toHaveBeenCalledTimes(1);
  unmount();
  expect(core.setModalOpen.mock.lastCall[1]).toBe(false);
});
