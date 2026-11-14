// The error hint for input easy reading does not present (#159, #160, #191).
// One wording for every easy-reading page; paste and typed text name the page.
export const UNSUPPORTED_KEY_HINT = '好讀模式目前不支援這個按鍵（關閉好讀模式可使用 PTT 原生操作）';

export const unsupportedPasteHint = (page) => '好讀模式目前不支援在' + page + '貼上文字';
export const unsupportedTextHint = (page) => '好讀模式目前不支援在' + page + '輸入文字';
