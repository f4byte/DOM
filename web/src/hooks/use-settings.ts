import { useQuery } from "@tanstack/react-query";
import type { SettingsResponse } from "@shared/types";
import { api } from "@/lib/api";

/** Profile, office schedule, automation options, TL link and device tokens (all stored in D1). */
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/settings"), staleTime: 30_000 });
