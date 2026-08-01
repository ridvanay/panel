import { apiFetch } from "./client";
import type { ChangePasswordRequest, UpdateUserRequest, User } from "./types";

export function getMe() {
  return apiFetch<User>("/users/me");
}

export function updateMe(input: UpdateUserRequest) {
  return apiFetch<User>("/users/me", { method: "PATCH", body: input });
}

export function changePassword(input: ChangePasswordRequest) {
  return apiFetch<void>("/users/me/change-password", { method: "POST", body: input });
}
