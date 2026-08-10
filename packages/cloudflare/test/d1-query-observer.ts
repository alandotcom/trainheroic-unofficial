export function observeD1Queries<T extends D1Database>(d1: T): { database: T; queries: string[] } {
  const queries: string[] = [];
  const database = new Proxy(d1, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          queries.push(query);
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, queries };
}
