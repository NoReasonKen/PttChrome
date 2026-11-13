import { useCallback, useState } from "react";
import {
  readSearchHistory,
  updateSearchHistory,
  searchHistoryKind,
  SEARCH_KINDS,
} from "../../js/search_history";
import { SearchKindControl } from "./SearchKindControl";
import HistoryManager from "./HistoryManager";

export const SearchHistoryManager = ({ toolbarTarget = null }) => {
  const [kind, setKind] = useState("title");
  const [history, setHistory] = useState(readSearchHistory);
  const onChange = useCallback(
    (change) => {
      setHistory(
        updateSearchHistory((current) => ({
          ...current,
          [kind]: change(searchHistoryKind(current, kind)),
        })),
      );
    },
    [kind],
  );

  return (
    <HistoryManager
      selectionKey={kind}
      history={searchHistoryKind(history, kind)}
      onChange={onChange}
      helpKey="searchHistoryManager_help"
      toolbarTarget={toolbarTarget}
      data-search-history-manager
    >
      <SearchKindControl kinds={SEARCH_KINDS} value={kind} onChange={setKind} />
    </HistoryManager>
  );
};

export default SearchHistoryManager;
