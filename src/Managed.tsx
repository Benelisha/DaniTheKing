import React, { useEffect, useState } from "react";
import { View, Text, Platform, Image, Pressable } from "react-native";
import { api } from "./firebase";
import { Button, Field, ExternalLink, s } from "./ui";
import { Lead } from "./types";
const finished = [
  "completed",
  "failed",
  "cancelled",
  "ready",
  "needs_review",
  "published",
];
export function ManagedSettings() {
  const [config, setConfig] = useState<any>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    api("/managed/settings")
      .then(setConfig)
      .catch((e) => setMessage(e.message));
  }, []);
  if (!config) return <Text>{message || "Loading Gemini settings…"}</Text>;
  return (
    <View style={[s.card, { gap: 12 }]}>
      <Text style={s.h2}>Gemini backend</Text>
      <Text style={s.body}>
        Research and generate in the cloud. Only your two approved accounts can
        use these operations.
      </Text>
      <Button
        label={
          config.enabled
            ? "Managed workflow enabled"
            : "Enable managed workflow"
        }
        onPress={() => setConfig({ ...config, enabled: !config.enabled })}
      />
      {["textModel", "imageModel", "promptVersion", "researchInstructions"].map(
        (key) => (
          <Field
            key={key}
            label={key}
            value={config[key]}
            onChangeText={(v) => setConfig({ ...config, [key]: v })}
          />
        ),
      )}
      <Text style={s.body}>
        Job budget: ${config.budgetUsd}. Each request reserves $
        {config.requestReserveUsd}; each image reserves $
        {config.imageReserveUsd}. Reservations are conservative allowances, not
        a provider invoice.
      </Text>
      <Button
        label="Save Gemini settings"
        onPress={() => {
          void api("/managed/settings", "PATCH", config)
            .then(() => setMessage("Settings saved"))
            .catch((e) => setMessage(e.message));
        }}
      />
      <Text>{message}</Text>
    </View>
  );
}
export function ManagedJobs({
  lead,
  refresh,
}: {
  lead?: Lead;
  refresh: () => Promise<void>;
}) {
  const [media, setMedia] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [page, setPage] = useState(""),
    [editing, setEditing] = useState(""),
    [brief, setBrief] = useState<Record<string, string>>(
      lead?.generationBrief || {
        audience: "Local homeowners",
        services: "",
        serviceArea: lead?.location || "",
        tone: "Professional and approachable",
        visualPreferences: "Clean, distinctive, accessible",
        callsToAction: "Call for service",
      },
    ),
    [followUp, setFollowUp] = useState(
      lead?.nextFollowUpAt?.slice(0, 10) || "",
    );
  const load = async () => {
    const all = await api<any[]>("/managed/jobs");
    setJobs(
      all.filter((j) => (lead ? j.leadId === lead.id : j.kind === "discovery")),
    );
    if (lead) setMedia(await api(`/managed/leads/${lead.id}/media`));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [lead?.id]);
  async function action(path: string, body: unknown = {}, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, method, body);
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.card, { gap: 14 }]}>
      <Text style={s.h2}>
        {lead ? "Gemini assistant" : "Discover US businesses"}
      </Text>
      <Text style={s.body}>
        {lead
          ? "Research public information, find people, or create a private landing-page draft."
          : "Uses the saved categories and US locations below. Results are added without overwriting existing leads."}
      </Text>
      <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
        {(lead ? ["research", "people", "generation"] : ["discovery"]).map(
          (kind) => (
            <Button
              key={kind}
              disabled={
                busy || (kind === "generation" && !lead?.googleVerified)
              }
              label={
                {
                  research: "Research business",
                  people: "Find people",
                  generation: "Generate landing page",
                  discovery: "Find businesses",
                }[kind]!
              }
              onPress={() =>
                void action(
                  lead
                    ? `/managed/leads/${lead.id}/${kind}`
                    : "/managed/discovery",
                )
              }
            />
          ),
        )}
      </View>
      {lead && (
        <>
          <Field
            label="Next follow-up (YYYY-MM-DD)"
            value={followUp}
            onChangeText={setFollowUp}
          />
          <Button
            subtle
            label="Save follow-up"
            disabled={busy}
            onPress={() => {
              if (followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp)) {
                setError("Use YYYY-MM-DD");
                return;
              }
              void action(
                `/leads/${lead.id}`,
                {
                  expectedVersion: lead.version,
                  nextFollowUpAt: followUp ? `${followUp}T12:00:00.000Z` : null,
                },
                "PATCH",
              );
            }}
          />
          <Text style={s.h2}>Images</Text>
          <Text style={s.body}>
            Selected uploads replace the default AI images, up to two per
            landing page. Upload only images you can use.
          </Text>
          {Platform.OS === "web" &&
            React.createElement("input", {
              type: "file",
              accept: "image/png,image/jpeg,image/webp",
              onChange: (event: any) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                  setError("Maximum upload is 8 MB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  void action(`/managed/leads/${lead.id}/media/upload`, {
                    base64: String(reader.result).split(",")[1],
                    caption: file.name,
                  });
                };
                reader.readAsDataURL(file);
              },
            })}
          {media.map((m) => (
            <View key={m.id}>
              <Image
                source={{ uri: m.dataUrl }}
                style={{ width: 220, height: 140, borderRadius: 8 }}
              />
              <Text>{m.caption}</Text>
              <Button
                subtle
                label={
                  m.selected
                    ? "Selected · remove from next generation"
                    : "Select for next generation"
                }
                onPress={() =>
                  void action(
                    `/managed/leads/${lead.id}/media/${m.id}`,
                    { selected: !m.selected },
                    "PATCH",
                  )
                }
              />
            </View>
          ))}
          <Text style={s.h2}>Landing-page requirements</Text>
          {Object.keys(brief).map((key) => (
            <Field
              key={key}
              label={key}
              value={brief[key]}
              onChangeText={(v) => setBrief({ ...brief, [key]: v })}
            />
          ))}
          <Button
            subtle
            label="Save requirements"
            disabled={busy}
            onPress={() =>
              void action(`/managed/leads/${lead.id}/brief`, brief, "PATCH")
            }
          />
        </>
      )}
      {!!error && <Text style={s.error}>{error}</Text>}
      {jobs.map((job) => (
        <View key={job.id} style={[s.card, { gap: 10 }]}>
          <Text style={s.h2}>
            {job.kind} · {job.status}
          </Text>
          <Text style={s.body}>
            {job.stage} · {new Date(job.createdAt).toLocaleString()} · $
            {Number(job.reservedUsd || 0).toFixed(2)} reserved / $
            {job.budgetUsd}
          </Text>
          {!!job.error && <Text style={s.error}>{job.error}</Text>}
          {!finished.includes(job.status) && (
            <Button
              subtle
              label="Cancel"
              onPress={() => void action(`/managed/jobs/${job.id}/cancel`)}
            />
          )}
          {["failed", "needs_review"].includes(job.status) && (
            <Button
              subtle
              label="Retry saved job"
              onPress={() => void action(`/managed/jobs/${job.id}/retry`)}
            />
          )}
          {job.findings && (
            <>
              {lead && (
                <Button
                  subtle
                  label="Accept these findings on lead record"
                  disabled={busy}
                  onPress={() =>
                    void action(`/managed/jobs/${job.id}/accept-findings`, {
                      expectedVersion: lead.version,
                    })
                  }
                />
              )}
              <Text style={s.body}>{job.findings.summary}</Text>
              {job.findings.people?.map((p: any, i: number) => (
                <View key={i}>
                  <Text style={s.h2}>
                    {p.name} {p.role ? `· ${p.role}` : ""}
                  </Text>
                  <Text>
                    {p.confidence} · {p.excerpt}
                  </Text>
                  <ExternalLink url={p.sourceUrl} label="Evidence" />
                </View>
              ))}
              {job.findings.facts?.map((f: any, i: number) => (
                <View key={i}>
                  <Text>
                    {f.field}: {f.value}
                  </Text>
                  <Text style={s.body}>{f.excerpt}</Text>
                  <ExternalLink url={f.sourceUrl} label="Source" />
                </View>
              ))}
              {job.findings.media?.map((m: any, i: number) => (
                <View key={i}>
                  <Text>{m.caption}</Text>
                  <ExternalLink url={m.sourceUrl} label="Media source" />
                  <ExternalLink url={m.url} label="View found image" />
                </View>
              ))}
              {job.findings.gaps?.map((g: string, i: number) => (
                <Text key={i}>Research gap: {g}</Text>
              ))}
            </>
          )}
          {job.references?.map((r: any, i: number) => (
            <View key={i}>
              <ExternalLink url={r.websiteUrl} label={r.businessName} />
              <Text style={s.body}>{r.observations}</Text>
              <Text>Strengths</Text>
              {r.strengths.map((v: string, k: number) => (
                <Text key={k}>+ {v}</Text>
              ))}
              <Text>Weaknesses</Text>
              {r.weaknesses.map((v: string, k: number) => (
                <Text key={k}>− {v}</Text>
              ))}
            </View>
          ))}
          {job.gaps?.map((g: string, i: number) => (
            <Text key={i}>{g}</Text>
          ))}
          {job.results && (
            <Text>
              {job.results.filter((r: any) => r.created).length} businesses
              added · {job.results.filter((r: any) => !r.created).length}{" "}
              existing businesses skipped
            </Text>
          )}
          {["ready", "published"].includes(job.status) && (
            <>
              <Button
                label="Open private preview"
                onPress={() => {
                  void api(`/managed/jobs/${job.id}/preview`)
                    .then((v) => {
                      setPreview(v.html);
                      setEditing(job.id);
                      setPage(JSON.stringify(job.page, null, 2));
                    })
                    .catch((e) => setError(e.message));
                }}
              />
              {job.status === "published" && (
                <>
                  <Button
                    subtle
                    label="Unpublish site"
                    disabled={busy}
                    onPress={() =>
                      void action(`/managed/jobs/${job.id}/unpublish`)
                    }
                  />
                  <Button
                    subtle
                    label="Restore this version"
                    disabled={busy}
                    onPress={() =>
                      void action(`/managed/jobs/${job.id}/publish`)
                    }
                  />
                </>
              )}
              {job.status === "ready" && (
                <Button
                  subtle
                  label="Publish this approved draft"
                  disabled={busy}
                  onPress={() => void action(`/managed/jobs/${job.id}/publish`)}
                />
              )}
            </>
          )}
        </View>
      ))}
      {!!preview && (
        <>
          <Text style={s.h2}>Private preview</Text>
          {Platform.OS === "web" &&
            React.createElement("iframe", {
              title: "Private landing page preview",
              sandbox: "",
              srcDoc: preview,
              style: { width: "100%", height: 650, border: "1px solid #ddd" },
              referrerPolicy: "no-referrer",
            })}
          <Field
            label="Draft content (JSON)"
            value={page}
            onChangeText={setPage}
            multiline
          />
          <Button
            label="Save draft content"
            onPress={() => {
              try {
                void action(
                  `/managed/jobs/${editing}/page`,
                  JSON.parse(page),
                  "PATCH",
                );
              } catch {
                setError("Invalid JSON");
              }
            }}
          />
          <Button subtle label="Close preview" onPress={() => setPreview("")} />
        </>
      )}
    </View>
  );
}

export function CompactGenerate({lead,refresh,running,onQueued}:{lead:Lead;refresh:()=>Promise<void>;running:boolean;onQueued:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <Pressable onPress={event=>event.stopPropagation()} style={{gap:4}}>
    <Button label={busy||running ? "Generating…" : "Generate"} icon="zap" disabled={busy||running||!lead.googleVerified||lead.callStatus==="Do not call"} onPress={()=>void(async()=>{
      setBusy(true);setError("");try{await api(`/managed/leads/${lead.id}/generation`,"POST",{});onQueued();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
    })()} />
    {!!error&&<Text style={s.error}>{error}</Text>}
  </Pressable>;
}
