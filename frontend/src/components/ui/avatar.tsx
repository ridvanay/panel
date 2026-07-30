function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  return initials.toUpperCase() || "?";
}

/**
 * Görsel bir avatar; erişilebilir isim her zaman bu bileşenin yanında ayrıca metin
 * olarak gösterildiği için burada dekoratif kabul edilir (alt="" / aria-hidden).
 */
export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- rastgele kullanıcı URL'si, next/image remotePatterns önceden bilinemez
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsOf(name)}
    </span>
  );
}
