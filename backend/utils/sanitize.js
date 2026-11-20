// ------------------------------------------------------------
// utils/sanitize.js - keeps clients from writing fields they must not control
// ------------------------------------------------------------

// Removes fields that only the server may set (owner id, database ids, timestamps).
// Without this a user could send { "userId": "<someone else>" } and write into another account.
export function cleanBody(body) {
  const { userId, _id, id, __v, createdAt, updatedAt, ...rest } = body && typeof body === 'object' ? body : {};
  return rest;
}
