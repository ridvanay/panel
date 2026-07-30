import { apiFetch } from "./client";
import type { Plan } from "./types";

export function listPlans() {
  return apiFetch<Plan[]>("/plans");
}
