import { apiFetch } from "./client";
import type { UpdateUserRequest, User } from "./types";

export function getMe() {
  return apiFetch<User>("/users/me");
}

export function updateMe(input: UpdateUserRequest) {
  return apiFetch<User>("/users/me", { method: "PATCH", body: input });
}
