// Named JSON imports keep engineering commit details out of the reading bundle.
const summaries = import.meta.glob("../../releases/*.json", { eager: true, import: "summary" });
const publications = import.meta.glob("../../releases/*.json", { eager: true, import: "publishedAt" });
const bundled = Object.entries(summaries).map(([file, summary]) => ({
  version: file.slice(file.lastIndexOf("/") + 1, -5),
  summary, publishedAt: publications[file],
}));

export function releaseHistory(records = bundled) {
  return records.filter(record => typeof record.publishedAt === "string" &&
    Number.isFinite(Date.parse(record.publishedAt))).sort((a, b) => {
    const left = a.version.split(".").map(Number);
    const right = b.version.split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (right[i] || 0) - (left[i] || 0);
      if (difference) return difference;
    }
    return 0;
  });
}

export function summaryForLocale(record, language = "") {
  return record.summary?.[/^zh(?:[-_]|$)/i.test(language) ? "zhTW" : "en"] || [];
}
