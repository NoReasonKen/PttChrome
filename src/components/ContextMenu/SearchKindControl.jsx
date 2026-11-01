import { SegmentedControl } from "@mantine/core";
import { i18n } from "../../js/i18n";
import { SEARCH_KIND_LABEL_KEY } from "../../js/search_history";
import "./SearchKindControl.css";

// 搜尋種類切換列（標題／作者／推文數／看板）：搜尋視窗與管理搜尋紀錄頁共用。
// 手機上英文放不下一行，就在格子裡換行。
// 快捷鍵跟前一個字黏在一起，只在字之間斷：「Push / count (Z)」。
const keepShortcut = (label) => label.replace(/ (\([^)]*\))$/, "\u00a0$1");

export const SearchKindControl = ({ kinds, ...rest }) => (
  <SegmentedControl
    fullWidth
    classNames={{ control: "searchKindItem", label: "searchKindLabel" }}
    data={kinds.map((k) => ({
      value: k,
      label: keepShortcut(i18n(SEARCH_KIND_LABEL_KEY[k])),
    }))}
    {...rest}
  />
);

export default SearchKindControl;
