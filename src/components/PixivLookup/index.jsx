import { useEffect, useState } from "react";
import { Modal } from "@mantine/core";
import { i18n } from "../../js/i18n";
import { pixivPageUrl, startPixivLookup } from "../../js/pixiv_lookup";
import MobileSheet from "../MobileSheet";
import { useDialogBack } from "../useDialogBack";
import "./PixivLookup.css";

const KINDS = ["user", "artwork"];
const validQuery = (query) =>
  typeof query === "string" && pixivPageUrl("user", query) !== null;
const emptyResults = (query) => ({
  query,
  user: { kind: "user", state: "loading" },
  artwork: { kind: "artwork", state: "loading" },
});

function ResultCard({ result, query }) {
  const { kind, state } = result;
  const [failedImage, setFailedImage] = useState(null);
  const found = state === "found";
  const reason =
    result.message ||
    (result.restriction && i18n("pixiv_" + result.restriction));
  const image =
    typeof result.image === "string" &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
      result.image,
    )
      ? result.image
      : null;
  const imageFailed = failedImage?.query === query && failedImage.src === image;
  return (
    <section
      className="PixivLookupCard"
      data-pixiv-kind={kind}
      data-pixiv-state={state}
    >
      {found ? (
        <>
          <a
            className="PixivLookupCard__Heading"
            href={pixivPageUrl(kind, query)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className="PixivLookupCard__Kind">{i18n("pixiv_" + kind)}</h3>
            <div className="PixivLookupCard__Name">{result.name}</div>
            {result.author && (
              <div className="PixivLookupCard__Author">{result.author}</div>
            )}
          </a>
          {result.description && (
            <p className="PixivLookupCard__Description">{result.description}</p>
          )}
          <div
            className="PixivLookupCard__Image"
            data-pixiv-image-state={
              image && !imageFailed
                ? "ready"
                : result.imagePending
                  ? "loading"
                  : "unavailable"
            }
          >
            {image && !imageFailed ? (
              <img
                src={image}
                alt={result.name || ""}
                draggable={false}
                onError={() => setFailedImage({ query, src: image })}
              />
            ) : (
              <span role="status">
                {result.imagePending
                  ? i18n("pixiv_loading")
                  : reason || i18n("pixiv_image_unavailable")}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <h3 className="PixivLookupCard__Kind">{i18n("pixiv_" + kind)}</h3>
          <p className="PixivLookupCard__Status" role="status">
            {state === "loading"
              ? i18n("pixiv_loading")
              : reason || i18n("pixiv_unavailable")}
          </p>
        </>
      )}
    </section>
  );
}

export function PixivLookup({ core, query, onClose, mobile = false }) {
  const opened = validQuery(query);
  const [results, setResults] = useState(() => emptyResults(query));
  useEffect(() => {
    if (!opened) return undefined;
    let active = true;
    setResults(emptyResults(query));
    const cancel = startPixivLookup(query, (result) => {
      if (!active || result.query !== query || !KINDS.includes(result.kind))
        return;
      setResults((current) => ({ ...current, [result.kind]: result }));
    });
    return () => {
      active = false;
      cancel();
    };
  }, [query, opened]);

  useEffect(() => {
    if (mobile || !core?.setModalOpen) return undefined;
    core.setModalOpen("pixivLookup", opened);
    return () => core.setModalOpen("pixivLookup", false);
  }, [core, opened, mobile]);
  useDialogBack(core, opened && !mobile, onClose);

  const current = results.query === query ? results : emptyResults(query);
  const visibleKinds = KINDS.filter(
    (kind) => current[kind].state !== "missing",
  );
  const title = `${i18n("pixiv_title")} · ${opened ? query : ""}`;
  const cards = (
    <div className="PixivLookup" data-pixiv-query={opened ? query : undefined}>
      {visibleKinds.length ? (
        <div className="PixivLookup__Cards">
          {visibleKinds.map((kind) => (
            <ResultCard key={kind} query={query} result={current[kind]} />
          ))}
        </div>
      ) : (
        <p className="PixivLookup__Empty" role="status" data-pixiv-empty>
          {i18n("pixiv_no_results")}
        </p>
      )}
    </div>
  );
  if (mobile) {
    return (
      <MobileSheet
        pttchrome={core}
        opened={opened}
        onClose={onClose}
        title={title}
        sheetKey="pixivLookup"
      >
        {cards}
      </MobileSheet>
    );
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="xl"
      centered
      zIndex={3000}
      returnFocus={false}
      withCloseButton={false}
      classNames={{
        content: "PixivLookupModal",
        header: "PixivLookupModal__Header",
        body: "PixivLookupModal__Body",
        title: "PixivLookupModal__Title",
      }}
    >
      {cards}
    </Modal>
  );
}

export default PixivLookup;
