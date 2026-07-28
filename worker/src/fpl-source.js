import { safeRequest } from './http.js';

export async function getFPLBootstrap() {
  return safeRequest(
    "https://fantasy.premierleague.com/api/bootstrap-static/"
  );
}
