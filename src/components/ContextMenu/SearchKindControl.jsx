import { SegmentedControl } from "@mantine/core";
import { i18n } from "../../js/i18n";
import { SEARCH_KIND_LABEL_KEY } from "../../js/search_history";
import "./SearchKindControl.css";

// 搜尋種類切換列（標題／作者／推文數／看板…）：搜尋視窗與管理搜尋紀錄頁共用。
// 手機上英文放不下一行，就在格子裡換行。
// 快捷鍵跟前一個字黏在一起，只在字之間斷：「Push / count (Z)」。
const keepShortcut = (label) => label.replace(/ (\([^)]*\))$/, "\u00a0$1");

// 一排放得下的種類數（原本的四種）。文章列表的其餘篩選（#298）一加進來就放不下一排，
// 續到第二排：每排還是同樣的 segmented 外觀、等寬填滿，選中的那格照舊反白。
export const SEGMENT_MAX_KINDS = 4;

const toData = (kinds) =>
  kinds.map((k) => ({
    value: k,
    label: keepShortcut(i18n(SEARCH_KIND_LABEL_KEY[k])),
  }));

export const SearchKindControl = ({ kinds, value, onChange, ...rest }) => {
  const classNames = { control: "searchKindItem", label: "searchKindLabel" };
  if (kinds.length <= SEGMENT_MAX_KINDS)
    return (
      <SegmentedControl
        fullWidth
        classNames={classNames}
        data={toData(kinds)}
        value={value}
        onChange={onChange}
        {...rest}
      />
    );
  // 平均分成幾排，每排等寬（八種＝4＋4）。
  const rows = Math.ceil(kinds.length / SEGMENT_MAX_KINDS);
  const size = Math.ceil(kinds.length / rows);
  const chunks = Array.from({ length: rows }, (_, i) =>
    kinds.slice(i * size, (i + 1) * size),
  );
  return (
    <div
      className="searchKindRows"
      data-search-kinds="wrap"
      style={{ marginBottom: rest.mb === "sm" ? 12 : undefined }}
    >
      {chunks.map((chunk, i) => (
        <SegmentedControl
          key={i}
          fullWidth
          classNames={classNames}
          data={toData(chunk)}
          // 選中的種類在另一排時，這一排沒有任何一格反白。
          value={chunk.includes(value) ? value : null}
          onChange={onChange}
        />
      ))}
    </div>
  );
};

export default SearchKindControl;
