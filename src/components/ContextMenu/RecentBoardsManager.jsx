import { useCallback, useSyncExternalStore } from "react";
import HistoryManager from "./HistoryManager";

const EMPTY_HISTORY = { pinned: [], recent: [] };

export default function RecentBoardsManager({
  homeDashboard,
  toolbarTarget = null,
}) {
  const subscribe = useCallback(
    (notify) => homeDashboard?.onChange(notify) || (() => {}),
    [homeDashboard],
  );
  const snapshot = useCallback(
    () => homeDashboard?.state.recentHistory || EMPTY_HISTORY,
    [homeDashboard],
  );
  const history = useSyncExternalStore(subscribe, snapshot);
  const onChange = useCallback(
    (change) => homeDashboard?.updateRecentHistory(change),
    [homeDashboard],
  );
  return (
    <HistoryManager
      history={history}
      onChange={onChange}
      helpKey="recentBoardsManager_help"
      emptyKey="recentBoardsManager_empty"
      caseInsensitive
      toolbarTarget={toolbarTarget}
      data-recent-boards-manager
    />
  );
}
