import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicContactFormServer } from "@/lib/api/server-contact";
import { ContactFormClient } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const form = await fetchPublicContactFormServer();
  if (!form) return {};
  return { title: form.title };
}

export default async function ContactPage() {
  const form = await fetchPublicContactFormServer();
  if (!form) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-semibold text-foreground">{form.title}</h1>
        {form.description && <p className="mt-2 text-sm text-foreground/60">{form.description}</p>}
      </div>
      <div className="mt-8">
        <ContactFormClient form={form} />
      </div>
    </div>
  );
}
