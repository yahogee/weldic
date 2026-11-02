/* Helpers for the work manual data (task cards and schedule events). */

/** Look up a task card by id. */
export function findTask(tasks, id) {
  return tasks.find((task) => task.id === id) || null;
}

/** Look up a document record (from the manifest) by its library path such as "법령/xxx.txt". */
export function findDocByFile(docs, file) {
  return docs.find((doc) => doc.file === `library/${file}`) || null;
}

/** Find one page/article of a document, or null while the document is still loading. */
export function findPage(store, doc, label) {
  const pages = store.pages.get(doc.id) || [];
  return pages.find((page) => page.label === label) || null;
}

/** Wrap task cards in the shape searchCards() already understands,
    so the existing search (text + initial consonants) is reused unchanged. */
export function toSearchShapes(tasks) {
  return tasks.map((task) => ({
    term: task.title,
    // 별칭에는 검색어(aliases)와 시스템 메뉴 이름(menu_paths)을 함께 넣어 메뉴 이름으로도 찾게 함
    aliases: [...(task.aliases || []), ...(task.menu_paths || [])],
    system: task.category,
    quote: (task.when || ""),
    gloss: [...task.steps, ...(task.cautions || [])].join(" "),
    ref: task,
  }));
}
