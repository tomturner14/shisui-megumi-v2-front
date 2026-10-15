// Only imported by explicitly generated/preloaded browser-test entrypoints.
// The normal Next and Worker entrypoints never expose this dispatcher.
export async function dispatchD1(db, payload) {
  const statement = ({ sql, values = [] }) => db.prepare(sql).bind(...values);
  if (payload.method === 'batch') return db.batch(payload.statements.map(statement));
  const query = statement(payload);
  switch (payload.method) {
    case 'run': return query.run();
    case 'all': return query.all();
    case 'first': return query.first(payload.column);
    default: throw new Error('Unsupported test D1 operation');
  }
}
