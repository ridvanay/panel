<?xml version="1.0" encoding="UTF-8"?>
<!--
  Paket S (2026-10-27) — sitemap'lerin tarayıcıda okunabilir görünümü. Arama motorları XML'i olduğu gibi
  okur; bu stil sayfası yalnızca insanlar içindir (sitemap index ve alt sitemap'ler için tek dosya).
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  exclude-result-prefixes="sm xhtml image">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>XML Sitemap</title>
        <style>
          :root { --brand: #4ab9e1; --brand-dark: #1f7ea3; --ink: #12324a; --muted: #5b7083; --line: #e3edf3; --bg: #f6fafc; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); }
          header { background: var(--brand); color: #fff; padding: 20px 24px; }
          header h1 { margin: 0; font-size: 20px; }
          header p { margin: 6px 0 0; font-size: 13px; opacity: .92; }
          main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 40px; }
          .count { font-size: 13px; color: var(--muted); margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; font-size: 13px; }
          th { text-align: left; background: #eaf6fb; color: var(--ink); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--line); }
          td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
          tr:last-child td { border-bottom: 0; }
          tr:hover td { background: #f3fafd; }
          a { color: var(--brand-dark); text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
          .num { text-align: right; white-space: nowrap; color: var(--muted); }
          .langs { color: var(--muted); font-size: 12px; }
        </style>
      </head>
      <body>
        <header>
          <h1>XML Sitemap</h1>
          <p>This is a sitemap for search engines. It lists the public pages of this site.</p>
        </header>
        <main>
          <xsl:choose>
            <xsl:when test="sm:sitemapindex">
              <p class="count"><xsl:value-of select="count(sm:sitemapindex/sm:sitemap)"/> sitemaps</p>
              <table>
                <tr><th>Sitemap</th><th class="num">Last modified</th></tr>
                <xsl:for-each select="sm:sitemapindex/sm:sitemap">
                  <tr>
                    <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
                    <td class="num"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
                  </tr>
                </xsl:for-each>
              </table>
            </xsl:when>
            <xsl:otherwise>
              <p class="count"><xsl:value-of select="count(sm:urlset/sm:url)"/> URLs</p>
              <table>
                <tr><th>URL</th><th class="num">Last modified</th><th>Languages</th><th class="num">Images</th></tr>
                <xsl:for-each select="sm:urlset/sm:url">
                  <tr>
                    <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
                    <td class="num"><xsl:value-of select="substring(sm:lastmod, 1, 10)"/></td>
                    <td class="langs">
                      <xsl:for-each select="xhtml:link[@hreflang != 'x-default']">
                        <xsl:value-of select="@hreflang"/>
                        <xsl:if test="position() != last()">, </xsl:if>
                      </xsl:for-each>
                    </td>
                    <td class="num"><xsl:value-of select="count(image:image)"/></td>
                  </tr>
                </xsl:for-each>
              </table>
            </xsl:otherwise>
          </xsl:choose>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
