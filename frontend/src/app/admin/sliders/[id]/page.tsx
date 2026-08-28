"use client";

import { use } from "react";
import { HeroStudio } from "@/components/admin/hero-studio/hero-studio";

export default function AdminSliderStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <HeroStudio sliderId={id} />;
}
