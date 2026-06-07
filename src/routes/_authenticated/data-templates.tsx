import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  FileSpreadsheet, Download, ListOrdered, AlertTriangle, Info, ChevronDown, ChevronLeft, Search,
} from "lucide-react";
import { CATALOG, GROUPS, IMPORT_ORDER, buildCatalogTemplate, type TemplateDef } from "@/lib/data-templates/catalog";

export const Route = createFileRoute("/_authenticated/data-templates")({
  head: () => ({ meta: [{ title: "قوالب البيانات" }] }),
  component: DataTemplatesPage,
});

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DataTemplatesPage() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? CATALOG.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.purpose.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q),
      )
    : CATALOG;

  const grouped = filtered.reduce<Record<string, TemplateDef[]>>((acc, t) => {
    (acc[t.group] ||= []).push(t);
    return acc;
  }, {});

  const handleDownload = async (tpl: TemplateDef) => {
    try {
      setDownloading(tpl.id);
      const blob = await buildCatalogTemplate(tpl.id);
      downloadBlob(blob, `template_${tpl.id}.xlsx`);
      toast.success(`تم تنزيل قالب: ${tpl.name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "فشل التنزيل";
      toast.error(msg);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6" />
          <h1 className="text-2xl font-bold">قوالب البيانات</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/data-readiness" className="text-primary underline-offset-4 hover:underline">
            ← جاهزية البيانات
          </Link>
          <span className="text-muted-foreground">|</span>
          <Link to="/import" className="text-primary underline-offset-4 hover:underline">
            استيراد Excel ←
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        مركز موحّد لجميع قوالب Excel اللازمة لتشغيل نظام إدارة الجداول الجامعية. هذه الصفحة للقراءة وتنزيل القوالب فقط — لا تجري أي عمليات استيراد أو كتابة على قاعدة البيانات.
      </p>

      {/* Import order guide */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <ListOrdered className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">دليل ترتيب الاستيراد</h2>
        </div>
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {IMPORT_ORDER.map((s) => (
            <li
              key={s.step}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {s.step}
                </span>
                <span>{s.label}</span>
              </div>
              {s.templateId && (
                <button
                  onClick={() => {
                    const el = document.getElementById(`tpl-${s.templateId}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setExpanded((p) => ({ ...p, [s.templateId!]: true }));
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  عرض
                </button>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          dir="rtl"
          placeholder="ابحث عن قالب..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Templates by group */}
      {(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((gKey) => {
        const list = grouped[gKey];
        if (!list || list.length === 0) return null;
        return (
          <section key={gKey} className="space-y-3">
            <h2 className="text-lg font-semibold">{GROUPS[gKey]}</h2>
            <div className="grid grid-cols-1 gap-3">
              {list
                .sort((a, b) => a.importOrder - b.importOrder)
                .map((tpl) => {
                  const open = !!expanded[tpl.id];
                  const required = tpl.columns.filter((c) => c.required);
                  const optional = tpl.columns.filter((c) => !c.required);
                  return (
                    <Card key={tpl.id} id={`tpl-${tpl.id}`} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold">{tpl.name}</h3>
                            <Badge variant="outline" className="text-[10px]">
                              ترتيب #{tpl.importOrder}
                            </Badge>
                            {tpl.requiredBeforeScheduling ? (
                              <Badge className="bg-emerald-600 text-white">مطلوب قبل الجدولة</Badge>
                            ) : (
                              <Badge variant="secondary">اختياري</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{tpl.purpose}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleDownload(tpl)}
                            disabled={downloading === tpl.id}
                          >
                            <Download className="h-4 w-4" />
                            {downloading === tpl.id ? "جارٍ التنزيل..." : "تنزيل القالب"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpanded((p) => ({ ...p, [tpl.id]: !open }))}
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                            {open ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                          </Button>
                        </div>
                      </div>

                      {open && (
                        <div className="mt-4 space-y-4 border-t pt-4 text-sm">
                          <div>
                            <div className="mb-1 flex items-center gap-2 font-semibold">
                              <span>الأعمدة المطلوبة</span>
                              <Badge variant="destructive" className="text-[10px]">
                                {required.length}
                              </Badge>
                            </div>
                            <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
                              {required.map((c) => (
                                <li
                                  key={c.header}
                                  className="flex items-start justify-between gap-2 rounded border bg-muted/30 px-2 py-1"
                                >
                                  <span className="font-mono text-xs">{c.header}</span>
                                  {c.allowed && (
                                    <span className="text-[10px] text-muted-foreground">{c.allowed}</span>
                                  )}
                                </li>
                              ))}
                              {required.length === 0 && (
                                <li className="text-muted-foreground">لا يوجد</li>
                              )}
                            </ul>
                          </div>

                          {optional.length > 0 && (
                            <div>
                              <div className="mb-1 font-semibold">الأعمدة الاختيارية</div>
                              <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
                                {optional.map((c) => (
                                  <li
                                    key={c.header}
                                    className="flex items-start justify-between gap-2 rounded border px-2 py-1"
                                  >
                                    <span className="font-mono text-xs">{c.header}</span>
                                    {c.allowed && (
                                      <span className="text-[10px] text-muted-foreground">{c.allowed}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {tpl.references && tpl.references.length > 0 && (
                            <div>
                              <div className="mb-1 flex items-center gap-2 font-semibold">
                                <Info className="h-4 w-4" />
                                <span>قيم مرجعية</span>
                              </div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {tpl.references.map((r) => (
                                  <div key={r.title} className="rounded border p-2">
                                    <div className="mb-1 text-xs font-semibold">{r.title}</div>
                                    <table className="w-full text-[11px]">
                                      <tbody>
                                        {r.rows.map((row, i) => (
                                          <tr key={i} className={i === 0 ? "font-semibold" : ""}>
                                            {row.map((cell, j) => (
                                              <td key={j} className="border-t px-1 py-0.5">
                                                {cell}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {tpl.commonErrors && tpl.commonErrors.length > 0 && (
                            <div>
                              <div className="mb-1 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-4 w-4" />
                                <span>أخطاء شائعة</span>
                              </div>
                              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                                {tpl.commonErrors.map((e, i) => (
                                  <li key={i}>{e}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {tpl.notes && (
                            <div className="rounded border bg-muted/30 p-2 text-xs">{tpl.notes}</div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
