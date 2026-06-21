/**
 * Minimal in-memory fake of the Firestore `db` surface used by the tool
 * handlers and query helpers. Implements only the chainable API that the
 * source actually calls:
 *   db.collection(path) -> .where / .orderBy / .startAfter / .limit / .get
 *                          .count().get() / .doc(id) / .add(data) / .listCollections()
 *   db.doc(path)        -> .get / .set / .update / .delete / .listCollections()
 *   db.getAll(...refs)  -> [snapshot, ...]
 *   db.listCollections()
 *
 * Seed with a map of `{ "collection/path": [{ id, ...fields }, ...] }`.
 */

function evalOperator(fieldValue, operator, value) {
  switch (operator) {
    case "==":
      return fieldValue === value;
    case "!=":
      return fieldValue !== value;
    case "<":
      return fieldValue < value;
    case "<=":
      return fieldValue <= value;
    case ">":
      return fieldValue > value;
    case ">=":
      return fieldValue >= value;
    case "array-contains":
      return Array.isArray(fieldValue) && fieldValue.includes(value);
    case "in":
      return Array.isArray(value) && value.includes(fieldValue);
    case "array-contains-any":
      return (
        Array.isArray(fieldValue) &&
        Array.isArray(value) &&
        fieldValue.some(v => value.includes(v))
      );
    default:
      throw new Error(`Unsupported operator in fake: ${operator}`);
  }
}

class DocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined && data !== null;
  }
  data() {
    return this._data;
  }
}

class DocumentReference {
  constructor(db, collectionPath, id) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.id = id;
  }
  _store() {
    return (this.db.data[this.collectionPath] ||= {});
  }
  async get() {
    return new DocumentSnapshot(this.id, this._store()[this.id]);
  }
  async set(data, options = {}) {
    const store = this._store();
    if (options.merge) {
      store[this.id] = { ...(store[this.id] || {}), ...data };
    } else {
      store[this.id] = { ...data };
    }
    this.db.writes.push({
      op: "set",
      path: this.collectionPath,
      id: this.id,
      data,
      options,
    });
    return this;
  }
  async update(data) {
    const store = this._store();
    if (!store[this.id]) throw new Error(`No document to update: ${this.id}`);
    store[this.id] = { ...store[this.id], ...data };
    this.db.writes.push({ op: "update", path: this.collectionPath, id: this.id, data });
    return this;
  }
  async delete() {
    delete this._store()[this.id];
    this.db.writes.push({ op: "delete", path: this.collectionPath, id: this.id });
    return this;
  }
  async listCollections() {
    return this.db._subcollectionsOf(`${this.collectionPath}/${this.id}`);
  }
}

class Query {
  constructor(db, collectionPath, state = {}) {
    this.db = db;
    this.collectionPath = collectionPath;
    this._filters = state._filters || [];
    this._orderBy = state._orderBy || null;
    this._startAfter = state._startAfter || null;
    this._limit = state._limit || null;
  }
  _clone(patch) {
    return new Query(this.db, this.collectionPath, {
      _filters: this._filters,
      _orderBy: this._orderBy,
      _startAfter: this._startAfter,
      _limit: this._limit,
      ...patch,
    });
  }
  where(field, operator, value) {
    return this._clone({ _filters: [...this._filters, { field, operator, value }] });
  }
  orderBy(field, direction = "asc") {
    return this._clone({ _orderBy: { field, direction } });
  }
  startAfter(doc) {
    return this._clone({ _startAfter: doc.id });
  }
  limit(n) {
    return this._clone({ _limit: n });
  }
  doc(id) {
    return new DocumentReference(this.db, this.collectionPath, id);
  }
  async add(data) {
    const id = `auto-${this.db._nextId++}`;
    await this.doc(id).set(data);
    return this.doc(id);
  }
  _rows() {
    const store = this.db.data[this.collectionPath] || {};
    let rows = Object.entries(store).map(([id, data]) => ({ id, data }));

    for (const { field, operator, value } of this._filters) {
      rows = rows.filter(r => evalOperator(r.data[field], operator, value));
    }

    if (this._orderBy) {
      const { field, direction } = this._orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return direction === "desc" ? -cmp : cmp;
      });
    }

    if (this._startAfter) {
      const idx = rows.findIndex(r => r.id === this._startAfter);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }

    if (this._limit != null) rows = rows.slice(0, this._limit);

    return rows;
  }
  async get() {
    const rows = this._rows();
    const docs = rows.map(r => new DocumentSnapshot(r.id, r.data));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  count() {
    const self = this;
    return {
      async get() {
        return { data: () => ({ count: self._rows().length }) };
      },
    };
  }
  async listCollections() {
    return this.db._subcollectionsOf(this.collectionPath);
  }
}

export class FakeFirestore {
  constructor(seed = {}) {
    // data: { "collection/path": { docId: { ...fields } } }
    this.data = {};
    this.writes = [];
    this._nextId = 1;
    for (const [path, docs] of Object.entries(seed)) {
      this.data[path] = {};
      for (const { id, ...fields } of docs) {
        this.data[path][id] = fields;
      }
    }
  }
  collection(path) {
    return new Query(this, path);
  }
  doc(path) {
    const parts = path.split("/");
    const id = parts.pop();
    return new DocumentReference(this, parts.join("/"), id);
  }
  async getAll(...refs) {
    return Promise.all(refs.map(ref => ref.get()));
  }
  async listCollections() {
    return this._subcollectionsOf("");
  }
  /** Top-level (or nested) collection ids living directly under `parentPath`. */
  _subcollectionsOf(parentPath) {
    const prefix = parentPath ? `${parentPath}/` : "";
    const ids = new Set();
    for (const path of Object.keys(this.data)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest || rest.includes("/")) continue; // only direct children
      if (Object.keys(this.data[path]).length > 0) ids.add(rest);
    }
    return [...ids].map(id => ({ id }));
  }
}

export function makeDb(seed) {
  return new FakeFirestore(seed);
}
