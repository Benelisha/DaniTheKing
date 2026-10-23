import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  Image,
  Modal,
  Switch,
  Linking,
} from "react-native";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth, api, allowedEmails } from "./src/firebase";
import { Login, VerifyEmail } from "./src/Login";
import {
  Badge,
  Button,
  Choices,
  ExternalLink,
  Field,
  FilterSelect,
  Icon,
  SocialLinks,
  s,
  colors,
} from "./src/ui";
import {
  Lead,
  Settings,
  Run,
  callStatuses,
  websiteStatuses,
} from "./src/types";
import { onlinePresence, matchesLead, socialPlatforms, presencePlatforms } from "./src/presence";
import {GenerationControls} from "./src/Generation";
function mapsUrl(lead: Lead) {
  return (lead.googleVerified ? lead.googleVerification?.listingUrl : undefined) || lead.profile?.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.businessName, lead.profile?.address || lead.location, lead.phone].join(" "))}`;
}
function workspacePage() {
  return typeof window !== "undefined" && window.location.pathname.replace(/\/$/, "") === "/discovery"
    ? "Discovery"
    : "Leads";
}
function leadIdFromPath() {
  if (typeof window === "undefined") return null;
  return /^\/leads\/([a-f0-9]{32})\/?$/.exec(window.location.pathname)?.[1] || null;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [verified, setVerified] = useState(false),
    [accessError, setAccessError] = useState("");
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (u && !allowedEmails.includes(u.email?.toLowerCase() || "")) {
          setUser(null);
          setVerified(false);
          setAccessError("This account is not authorized. You have been signed out. Use your approved team account.");
          setReady(true);
          void signOut(auth).catch(() => {
            setAccessError("This account is not authorized. Sign-out failed; reload to try again. Business data remains blocked.");
          });
          return;
        }
        if (u) setAccessError("");
        setUser(u);
        setVerified(!!u?.emailVerified);
        setReady(true);
      }),
    [],
  );
  if (!ready)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  if (!user) return <Login accessError={accessError} />;
  if (!verified) return <VerifyEmail onVerified={() => setVerified(true)} />;
  return <Workspace key={user.uid} />;
}
function Workspace() {
  const { width } = useWindowDimensions(),
    wide = width > 1050;
  const [page, setPage] = useState(workspacePage),
    [navigationOpen, setNavigationOpen] = useState(false),
    [leads, setLeads] = useState<Lead[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sort, setSort] = useState("Newest first"),
    [query, setQuery] = useState(""),
    [platformFilter, setPlatformFilter] = useState("All platforms"),
    [presenceFilter, setPresenceFilter] = useState("All findings"),
    [selectedId, setSelectedId] = useState<string | null>(leadIdFromPath);
  const selected = leads.find(lead => lead.id === selectedId) || null;
  function openLead(lead: Lead) {
    if (typeof window !== "undefined") window.history.pushState(null, "", `/leads/${lead.id}`);
    setSelectedId(lead.id);
  }
  function closeLead() {
    if (typeof window !== "undefined") window.history.pushState(null, "", "/leads");
    setSelectedId(null);
  }
  function navigateWorkspace(nextPage: string) {
    if (typeof window !== "undefined") {
      const path = nextPage === "Leads" ? "/leads" : "/discovery";
      if (window.location.pathname !== path) window.history.pushState(null, "", path);
    }
    setSelectedId(null);
    setNavigationOpen(false);
    setPage(nextPage);
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      setSelectedId(leadIdFromPath());
      setPage(workspacePage());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const refresh = useCallback(async () => {
    setError("");
    try {
      let result: Lead[] = [],
        cursor: string | null = null;
      do {
        const data: { leads: Lead[]; cursor: string | null } = await api<{
          leads: Lead[];
          cursor: string | null;
        }>(`/leads?view=all${cursor ? `&cursor=${cursor}` : ""}`);
        result = result.concat(data.leads);
        cursor = data.cursor;
      } while (cursor);
      setLeads(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  const updateLeadStatus = useCallback((id: string, callStatus: string, version: number) => {
    setLeads(current => current.map(lead => lead.id === id ? {...lead, callStatus, version} : lead));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const sortedLeads = leads.filter(l => matchesLead(l, query) && onlinePresence(l).some(p => (platformFilter === "All platforms" || p.platform === platformFilter) && (presenceFilter === "All findings" || p.status === presenceFilter))).sort((a, b) => sort === "Business A–Z"
    ? a.businessName.localeCompare(b.businessName)
    : sort === "Fewest examples" ? (a.competitors?.length || 0) - (b.competitors?.length || 0)
    : (b.createdAt || "").localeCompare(a.createdAt || ""));
  const navigation = (
    <View style={[styles.sidebar, { height: "100%" }]}>
      {!wide && (
        <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => setNavigationOpen(false)} style={{ alignSelf: "flex-end", padding: 8, marginBottom: 16 }}>
          <Icon name="x" color="#fff" />
        </Pressable>
      )}
      {wide && <Text style={styles.brand}>dani<Text style={{ color: "#9ed4a8" }}>boy.</Text></Text>}
      {["Leads", "Discovery"].map(p => (
        <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: page === p }} onPress={() => navigateWorkspace(p)} style={[styles.nav, page === p && { backgroundColor: "#2b5145" }]}>
          <Icon name={p === "Leads" ? "grid" : "compass"} color={page === p ? "#bfe4bc" : "#93aea1"} />
          <Text style={{ color: page === p ? "#fff" : "#a2b9ae", fontWeight: "600", fontSize: 14 }}>{p}</Text>
        </Pressable>
      ))}
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" onPress={() => void signOut(auth)} style={{ paddingVertical: 16 }}>
        <Text style={{ color: "#a2b9ae", fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </View>
  );
  return (
    <View style={styles.app}>
      {wide && navigation}
      {!wide && <Modal transparent visible={navigationOpen} animationType="fade" onRequestClose={() => setNavigationOpen(false)}>
        <View style={[styles.scrim, { alignItems: "flex-start" }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss navigation" onPress={() => setNavigationOpen(false)} style={StyleSheet.absoluteFillObject} />
          {navigation}
        </View>
      </Modal>}
      <View style={{ flex: 1 }}>
        {!wide && <View style={styles.topbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open navigation" accessibilityState={{ expanded: navigationOpen }} onPress={() => setNavigationOpen(true)} style={{ padding: 12 }}>
            <Icon name="menu" color={colors.ink} size={24} />
          </Pressable>
        </View>}
        <ScrollView
          contentContainerStyle={{
            padding: wide ? 36 : 18,
            paddingBottom: 70,
            gap: 24,
          }}
        >
          {page === "Leads" ? (
            <>
              {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
              <View style={[s.card, { padding: 0, gap: 0, overflow: "hidden" }]}>
                <View style={{ padding: 20, gap: 12 }}>

                  <Field placeholder="Search name, address, phone, Instagram, Facebook, websites…" value={query} onChangeText={setQuery} />
                  <View style={[s.row, {flexWrap:"wrap",gap:12}]}>
                    <View style={{flex:1,minWidth:180}}><FilterSelect label="Platform" values={["All platforms", ...presencePlatforms]} value={platformFilter} onChange={setPlatformFilter} /></View>
                    <View style={{flex:1,minWidth:180}}><FilterSelect label="Finding" values={["All findings", "Found", "Not found", "Not checked"]} value={presenceFilter} onChange={setPresenceFilter} /></View>
                    <Button subtle label="Clear search & filters" onPress={()=>{setQuery("");setPlatformFilter("All platforms");setPresenceFilter("All findings");}} />
                  </View>
                  <View style={{ width: wide ? 220 : "100%" }}>
                    <FilterSelect label="Sort" values={["Newest first", "Business A–Z", "Fewest examples"]} value={sort} onChange={setSort} />
                  </View>
                </View>
                {wide && (
                  <View
                    style={[
                      styles.tableRow,
                      { backgroundColor: "#f6f8f4", paddingVertical: 12 },
                    ]}
                  >
                    {[
                      "BUSINESS / SERVICE",
                      "LOCATION",
                      "WEBSITE CHECK",
                      "CALL STATUS",
                      "GENERATED WEBSITE",
                    ].map((v, i) => (
                      <Text
                        key={v}
                        style={[
                          styles.col,
                          {
                            flex: i === 0 ? 1.5 : 1,
                            fontSize: 10,
                            fontWeight: "600",
                            letterSpacing: 1,
                            color: colors.muted,
                          },
                        ]}
                      >
                        {v}
                      </Text>
                    ))}
                  </View>
                )}
                {loading ? (
                  <View style={{ padding: 50 }}>
                    <ActivityIndicator color={colors.green} />
                  </View>
                ) : sortedLeads.length ? (
                  sortedLeads.map((l) => (
                    <Pressable
                      key={l.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${l.businessName}`}
                      onPress={() => openLead(l)}
                      style={({ hovered }: any) => [
                        styles.tableRow,
                        !wide && {
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 12,
                        },
                        hovered && { backgroundColor: "#f5f9f2" },
                      ]}
                    >
                      <View
                        style={[
                          styles.col,
                          {
                            flex: wide ? 1.5 : undefined,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                          },
                        ]}
                      >
                        <View style={styles.businessIcon}>
                          <Icon name="home" color={colors.green} />
                        </View>
                        <View style={{ gap: 5, flex: 1 }}>
                          <Text
                            style={{
                              fontSize: 14,
                              fontWeight: "600",
                              color: colors.ink,
                            }}
                          >
                            {l.businessName}
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.muted }}>
                            {l.service}
                          </Text>
                          <VerificationBadge lead={l} />
                          <Text style={{ fontSize: 11, color: colors.muted }}>{l.competitors?.length || 0}/5 business examples{l.potentialDuplicateId ? " · Duplicate review" : ""}</Text>
                          <SocialLinks lead={l} />
                        </View>
                      </View>
                      <View style={[styles.col, { gap: 5 }]}>
                        <Text style={{ fontSize: 12, color: colors.ink }}>
                          {l.profile?.address || l.location}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.muted }}>
                          {l.phone}
                        </Text>
                      </View>
                      <View style={[styles.col, { gap: 5 }]}>
                        <Badge text={l.websiteStatus} />
                        <Text style={{ fontSize: 10, color: colors.muted }}>
                          {l.websiteCheckedAt
                            ? `Checked ${new Date(l.websiteCheckedAt).toLocaleDateString(undefined, { timeZone: "UTC" })}`
                            : "Awaiting research"}
                        </Text>
                      </View>
                      <View style={styles.col}>
                        <Badge text={l.callStatus} />
                      </View>
                      <View style={[styles.col, { gap: 5 }]}>
                        <GenerationControls lead={l} refresh={refresh}/>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <View style={{ padding: 50, alignItems: "center", gap: 12 }}>
                    <Icon name="search" size={28} />
                    <Text style={s.h2}>{leads.length ? "No leads match your search" : "No leads yet"}</Text>
                  </View>
                )}
              </View>
            </>
          ) : (
            <Text style={s.h2}>Coming soon</Text>
          )}
        </ScrollView>
      </View>
      <Modal
        transparent
        visible={!!selected}
        animationType="fade"
        onRequestClose={closeLead}
      >
        <View style={styles.scrim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close lead details"
            onPress={closeLead}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[styles.drawer, { width: width > 650 ? 580 : "100%" }]}>
            {selected && (
              <LeadDetail
                key={selected.id}
                lead={selected}
                refresh={refresh}
                onStatusSaved={updateLeadStatus}
                close={closeLead}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
function ImportLeads({ close, refresh }: { close: () => void; refresh: () => Promise<void> }) {
  const [payload, setPayload] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit() {
    setError(""); setMessage(""); setBusy(true);
    try {
      const rows = JSON.parse(payload);
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) throw new Error("Paste a JSON array containing 1–50 businesses.");
      const result = await api("/ingest?skipExisting=true", "POST", rows);
      const created = result.results.filter((r: { created: boolean }) => r.created).length;
      setMessage(`${created} added · ${result.results.length - created} existing businesses skipped. Refreshing directory…`);
      await refresh();
    } catch (e) { setError((e as Error).message + " If the connection failed, retry the same batch; existing phone numbers are skipped."); }
    finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={{ padding: 28, gap: 18 }}>
    <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h2}>Import researched businesses</Text><Button subtle label="Close" onPress={close} /></View>
    <ExternalLink url={`${typeof window !== "undefined" ? window.location.origin : "https://daniboy-be1c0.web.app"}/docs/RESEARCH-BRIEF.md`} label="Open research brief (.md)" />
    <ExternalLink url={`${typeof window !== "undefined" ? window.location.origin : "https://daniboy-be1c0.web.app"}/docs/BACKOFFICE-API.md`} label="Open API and import guide (.md)" />
    <Text style={s.body}>1. Follow docs/RESEARCH-BRIEF.md with your local LLM. Search each selected service and city, compare against all existing leads, and retain dated sources.</Text>
    <Text style={s.body}>2. Collect business phone, address, Maps listing, rating, review count, review excerpts, image links, hours and services when available. Leave unknown fields out.</Text>
    <Text style={s.body}>3. Find five distinct competitors for the same job type and service area. Open each independent website and record identity verification, source URL and date. Incomplete research is visible in the business profile.</Text>
    <Text style={s.body}>4. Follow docs/BACKOFFICE-API.md. Keep CSV locally if useful, then convert to the documented JSON array and paste up to 50 businesses below. The server validates the whole batch before writing; later database failures may leave a partial import.</Text>
    <Text style={s.body}>Existing phone numbers are skipped without changing call history. Same name/location with another phone is flagged for review. Review every possible duplicate before calling.</Text>
    <Field label="Research JSON array" multiline value={payload} onChangeText={setPayload} placeholder="Paste your JSON array here" style={{ minHeight: 230 }} />
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!message && <Text accessibilityRole="alert" style={s.body}>{message}</Text>}
    <Button label={busy ? "Importing…" : "Import · skip existing phones"} icon="upload" disabled={busy || !payload.trim()} onPress={() => void submit()} />
  </ScrollView>;
}
function LeadDetail({
  lead,
  close,
  refresh,
  onStatusSaved,
}: {
  lead: Lead;
  close: () => void;
  refresh: () => Promise<void>;
  onStatusSaved: (id: string, status: string, version: number) => void;
}) {
  const [status, setStatus] = useState(lead.callStatus),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [history, setHistory] = useState<any[]>([]);
  const loadHistory = useCallback(
    () =>
      api(`/leads/${lead.id}/activity`)
        .then(setHistory)
        .catch((e) => setError(e.message)),
    [lead.id, lead.version],
  );
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  useEffect(() => setStatus(lead.callStatus), [lead.callStatus]);
  async function save(nextStatus = status) {
    if (busy) return;
    setSaved("");
    setBusy(true);
    setError("");
    try {
      const result = await api<{version: number}>(`/leads/${lead.id}`, "PATCH", {
        expectedVersion: lead.version,
        callStatus: nextStatus,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote("");
      onStatusSaved(lead.id, nextStatus, result.version);
      setSaved("Saved to Firestore.");
      await loadHistory();
    } catch (e) {
      setStatus(lead.callStatus);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Text style={{ fontSize: 11, letterSpacing: 2, color: colors.green }}>
          BUSINESS PROFILE
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close lead details" onPress={close} style={{padding:10}}><Icon name="x" size={22} /></Pressable>
      </View>
      <View style={{gap:8}}>
        <Text style={s.h1}>{lead.businessName}</Text>
        <Text style={s.body}>{lead.service} · {lead.profile?.address || lead.location}</Text>
        <VerificationBadge lead={lead} />
        <View style={[s.row, {flexWrap:"wrap",gap:16}]}>
          <ExternalLink url={mapsUrl(lead)} label="Google Maps" />
          {!!lead.websiteUrl && <ExternalLink url={lead.websiteUrl} label="Website" />}
          {!!lead.profile?.publicEmail && <ExternalLink url={`mailto:${lead.profile.publicEmail}`} label="Email" />}
          <ExternalLink url={`tel:${lead.phone}`} label={lead.phone} />
        </View>
        <SocialLinks lead={lead} />
        <Button label={lead.callStatus === "Do not call" ? "Do not call — contact suppressed" : "Call business"} icon="phone" disabled={lead.callStatus === "Do not call"} onPress={() => void Linking.openURL(`tel:${lead.phone}`)} />
        {!!lead.potentialDuplicateId && <Text style={s.error}>Possible duplicate — review before calling.</Text>}
      </View>
      <ReviewAssets lead={lead} />
      <View style={s.section}>
        <Text style={s.h2}>Call status</Text>
        <Choices values={callStatuses} value={status} onChange={(next) => { if (!busy) { setStatus(next); void save(next); } }} />
        {busy && <Text accessibilityRole="alert" style={s.body}>Saving to Firestore…</Text>}
        {!!saved && <Text accessibilityRole="alert" style={s.body}>{saved}</Text>}
        <DetailSection title="Add a call note">
        <Field
          label="Add a call note"
          multiline
          value={note}
          onChangeText={setNote}
          placeholder="Who did you speak to? What should happen next?"
        />
        {!!error && <Text style={s.error}>{error}</Text>}
        <Button
          label={busy ? "Saving…" : "Save call update"}
          disabled={busy}
          onPress={() => void save()}
        />
        </DetailSection>
      </View>
      <ContentEditor key={`${lead.id}:${lead.version}`} lead={lead} refresh={refresh} />
      <DetailSection title="Generated website">
        <GenerationControls lead={lead} refresh={refresh}/>
      </DetailSection>
      <DetailSection title={`Business examples · ${lead.competitors?.length || 0}`}>
        {lead.competitors?.map((competitor, i) => <View key={i} style={{gap:6}}>
          <ExternalLink url={competitor.websiteUrl} label={competitor.businessName} />
          <Text style={s.body}>{competitor.verificationNotes}</Text>
        </View>)}
      </DetailSection>
      <DetailSection title="Research & business details">
        <Badge text={lead.websiteStatus} />
        {!!lead.researchNotes && <Text style={s.body}>{lead.researchNotes}</Text>}
        {!!lead.profile?.addressNotes && <Text style={s.body}>{lead.profile.addressNotes}</Text>}
        {!!lead.profile?.openingHours && <Text style={s.body}>{lead.profile.openingHours}</Text>}
        {!!lead.profile?.services?.length && <Text style={s.body}>{lead.profile.services.join(", ")}</Text>}
        {lead.evidence.map((e,i)=><Text key={i} style={s.body}>{e.summary}</Text>)}
      </DetailSection>
      <ResearchEditor lead={lead} refresh={refresh} />
      <DetailSection title="Sources">
        {lead.sources.filter(source => !/google\.[^/]+\/maps|maps\.google\./i.test(source.url)).map((source, i) => (
          <View key={i} style={{ gap: 4 }}>
            <ExternalLink url={source.url} label={source.title || source.url} />
            <Text style={s.body}>
              Observed{" "}
              {new Date(source.observedAt).toLocaleDateString(undefined, {
                timeZone: "UTC",
              })}
            </Text>
          </View>
        ))}
      </DetailSection>
      <DetailSection title={`Call history · ${history.length}`}>
        {history.length ? (
          history.map((h) => (
            <View key={h.id} style={{ gap: 6, paddingVertical: 10 }}>
              <Text
                style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}
              >
                {h.toStatus} · {h.actor}
              </Text>
              {!!h.note && <Text style={s.body}>{h.note}</Text>}
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {new Date(h.at).toLocaleString()}
              </Text>
            </View>
          ))
        ) : (
          <Text style={s.body}>No calls logged yet.</Text>
        )}
      </DetailSection>
    </ScrollView>
  );
}
function VerificationBadge({lead}:{lead:Lead}) {
  return <View style={[s.row,{gap:5}]}><Icon name={lead.googleVerified ? "check-circle" : "circle"} size={14} color={lead.googleVerified ? colors.green : colors.muted}/><Text style={{fontSize:11,color:lead.googleVerified ? colors.green : colors.muted}}>{lead.googleVerified ? "Verified" : "Unverified"}</Text></View>;
}
function DetailSection({title,children}:{title:string;children:React.ReactNode}) {
  const [open,setOpen]=useState(false);
  return <View style={s.section}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={[s.row,{justifyContent:"space-between",paddingVertical:6}]}><Text style={s.h2}>{title}</Text><Icon name={open?"chevron-up":"chevron-down"}/></Pressable>
    {open && children}
  </View>;
}
function ReviewAssets({lead}:{lead:Lead}) {
  const profile=lead.profile;
  return <View style={{gap:12}}>
    {!!profile?.staff?.length && <View style={{gap:8}}>
      <Text style={s.h2}>People mentioned in reviews</Text>
      {profile.staff.map((person,i)=><View key={i} style={{gap:3}}>
        <ExternalLink url={person.sourceUrl} label={`${person.name}${person.role ? ` · ${person.role}` : ""}`} />
        <Text style={s.body}>{person.excerpt}</Text>
      </View>)}
    </View>}
    {!!profile?.images?.length && <View style={{gap:8}}>
      <Text style={s.h2}>Photos · {profile.images.length}</Text>
      <ScrollView horizontal contentContainerStyle={{gap:10}}>
        {profile.images.map((photo,i)=><View key={i} style={{width:128,gap:4}}>
          <Pressable accessibilityRole="link" accessibilityLabel={photo.caption || `Photo ${i+1}`} onPress={()=>void Linking.openURL(photo.url)}><Image source={{uri:photo.url}} style={{width:128,height:96,borderRadius:8,backgroundColor:colors.pale}}/><Text numberOfLines={1} style={s.body}>{photo.caption || `Photo ${i+1}`}</Text></Pressable>
          <ExternalLink url={photo.sourceUrl} label="Source review / photo" />
        </View>)}
      </ScrollView>
    </View>}
    {!!profile?.reviews?.length && <DetailSection title={`Reviews · ${profile.reviews.length}${profile.rating !== undefined ? ` · ★ ${profile.rating}` : ""}`}>
      {profile.reviews.map((review,i)=><View key={i} style={{gap:5,paddingVertical:6}}><Text style={s.body}>{review.text}</Text><ExternalLink url={review.sourceUrl} label={`${review.author} · ${review.rating ?? "—"} / 5`} /></View>)}
    </DetailSection>}
  </View>;
}
function ResearchEditor({
  lead,
  refresh,
}: {
  lead: Lead;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [status, setStatus] = useState(lead.websiteStatus),
    [url, setUrl] = useState(lead.websiteUrl),
    [source, setSource] = useState(""),
    [summary, setSummary] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/leads/${lead.id}/research`, "PATCH", {
        websiteStatus: status,
        websiteUrl: url,
        sourceUrl: source,
        summary,
        expectedVersion: lead.version,
      });
      await refresh();
      setEditing(false);
      setSummary("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.section}>
      <Button
        subtle
        label={editing ? "Cancel website review" : "Update website review"}
        onPress={() => setEditing(!editing)}
      />
      {editing && (
        <>
          <Choices
            values={websiteStatuses}
            value={status}
            onChange={setStatus}
          />
          <Field
            label="Independent website URL (if found)"
            value={url}
            onChangeText={setUrl}
          />
          <Field
            label="Evidence source URL"
            value={source}
            onChangeText={setSource}
          />
          <Field
            label="What did you verify? Include alternate-name checks or owner confirmation."
            multiline
            value={summary}
            onChangeText={setSummary}
          />
          {!!error && <Text style={s.error}>{error}</Text>}
          <Button
            label={busy ? "Saving…" : "Save dated review"}
            disabled={busy}
            onPress={() => void save()}
          />
        </>
      )}
    </View>
  );
}
function AddLead({
  close,
  refresh,
}: {
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
      businessName: "",
      phone: "",
      service: "",
      location: "",
      source: "",
      researchNotes: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("/leads", "POST", {
        businessName: form.businessName,
        phone: form.phone,
        service: form.service,
        location: form.location,
        researchNotes: form.researchNotes,
        sources: [
          {
            url: form.source,
            title: "Manual research source",
            observedAt: new Date().toISOString(),
          },
        ],
      });
      await refresh();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 28, gap: 20 }}>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Text style={s.h2}>Add a business</Text>
        <Button subtle label="Close" onPress={close} />
      </View>
      <Text style={s.body}>
        Start with a public source. New businesses are marked “Not checked”
        until website evidence is recorded through ingestion.
      </Text>
      {(
        [
          ["businessName", "Business name"],
          ["phone", "Public US phone"],
          ["service", "Service category"],
          ["location", "City / state"],
          ["source", "Source URL"],
          ["researchNotes", "Research notes"],
        ] as const
      ).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          value={form[key]}
          onChangeText={(v) => setForm({ ...form, [key]: v })}
          multiline={key === "researchNotes"}
        />
      ))}
      {!!error && <Text style={s.error}>{error}</Text>}
      <Button
        label={busy ? "Saving…" : "Add to calling list"}
        disabled={busy}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}
function Discovery({
  config,
  integration,
  runs,
  categories,
  refresh,
}: {
  config: Settings;
  integration: any;
  runs: Run[];
  categories: string[];
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(config),
    [locations, setLocations] = useState(config.locations.join("\n")),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/settings", "PATCH", {
        ...draft,
        locations: locations
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      });
      setMessage("Schedule saved.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/discovery/run", "POST", {});
      setMessage(`Discovery ${r.status}${r.message ? `: ${r.message}` : ""}.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <View style={[s.card, { gap: 20 }]}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ gap: 7 }}>
            <Text style={s.h2}>Manual Google Maps research</Text>
            <Text style={s.body}>
              Automated discovery is disabled. Verify actual Google Maps listings
              before adding businesses to the working list.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable scheduled discovery"
            disabled
            value={false}
            onValueChange={(enabled) => setDraft({ ...draft, enabled })}
            trackColor={{ true: colors.green }}
          />
        </View>
        <Badge
          text={
            !integration?.ready
              ? "blocked"
              : draft.enabled
                ? "Schedule enabled"
                : "Schedule paused"
          }
        />
        {!integration?.ready && (
          <Text style={s.error}>
            Use manual Google Maps verification. Search-only links and directory-only
            businesses do not qualify for the working lead list.
          </Text>
        )}
        <View style={[s.row, { flexWrap: "wrap" }]}>
          {draft.times.map((time, i) => (
            <Field
              key={i}
              label={`Daily run ${i + 1} (HH:mm)`}
              value={time}
              onChangeText={(v) =>
                setDraft({
                  ...draft,
                  times: draft.times.map((x, j) => (i === j ? v : x)),
                })
              }
            />
          ))}
        </View>
        <Text style={s.body}>
          Use 15-minute intervals, such as 09:00, 13:00, and 17:00. Times follow
          the selected time zone, including daylight saving.
        </Text>
        <Field
          label="Time zone"
          value={draft.timeZone}
          onChangeText={(timeZone) => setDraft({ ...draft, timeZone })}
        />
        <Field
          label="Candidate limit per run (1–20)"
          value={String(draft.maxCandidates)}
          keyboardType="number-pad"
          onChangeText={(v) => setDraft({ ...draft, maxCandidates: Number(v) })}
        />
        <Field
          label="Search locations — one US city/state per line"
          multiline
          value={locations}
          onChangeText={setLocations}
        />
        <Text style={s.label}>
          Service coverage · {draft.categories.length} selected
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
          {categories.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.categories.includes(c) }}
              onPress={() =>
                setDraft({
                  ...draft,
                  categories: draft.categories.includes(c)
                    ? draft.categories.filter((x) => x !== c)
                    : [...draft.categories, c],
                })
              }
              style={[
                s.chip,
                draft.categories.includes(c) && {
                  backgroundColor: "#e5f0e7",
                  borderColor: colors.green,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: draft.categories.includes(c)
                    ? colors.green
                    : colors.muted,
                }}
              >
                {c}
              </Text>
            </Pressable>
          ))}
        </View>
        {!!error && <Text style={s.error}>{error}</Text>}
        {!!message && <Text style={s.body}>{message}</Text>}
        <View style={[s.row, { flexWrap: "wrap" }]}>
          <Button
            label={busy ? "Working…" : "Save schedule"}
            disabled={busy}
            onPress={() => void save()}
          />
          <Button
            subtle
            label="Run saved configuration now"
            disabled
            onPress={() => void run()}
          />
        </View>
      </View>
      <View style={s.card}>
        <Text style={s.h2}>Recent discovery runs</Text>
        {runs.length ? (
          runs.map((r) => (
            <View key={r.id} style={[s.section, { paddingVertical: 12 }]}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <Badge text={r.status} />
                <Text style={s.body}>
                  {new Date(r.startedAt).toLocaleString()}
                </Text>
              </View>
              <Text style={s.body}>
                {r.query || r.message || "Scheduled discovery"}
                {r.query && r.message ? ` · ${r.message}` : ""}
              </Text>
              <Text style={s.body}>
                {r.created || 0} new · {r.merged || 0} merged ·{" "}
                {r.reviewed || 0} reviewed
              </Text>
            </View>
          ))
        ) : (
          <Text style={s.body}>
            No runs yet. Scheduled runs will appear here with their results or a
            clear blocker.
          </Text>
        )}
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  app: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  sidebar: { width: 218, backgroundColor: "#173d33", padding: 24 },
  brand: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -1,
    marginBottom: 58,
  },
  sidebarLabel: {
    color: "#6f9582",
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 16,
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  navCount: {
    marginLeft: "auto",
    fontSize: 11,
    color: "#d0e4d4",
    backgroundColor: "#3f6053",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  team: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: "#345548",
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: 20,
    backgroundColor: "#3a5a4c",
    alignItems: "center",
    justifyContent: "center",
  },
  topbar: {
    height: 60,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 19,
    borderTopWidth: 1,
    borderTopColor: "#edf0eb",
  },
  col: { flex: 1 },
  businessIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#edf3e9",
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: { flex: 1, backgroundColor: "#102c2860", alignItems: "flex-end" },
  drawer: {
    height: "100%",
    backgroundColor: "#fff",
    borderLeftWidth: 1,
    borderColor: colors.line,
  },
});

function ContentEditor({lead, refresh}: {lead:Lead; refresh:()=>Promise<void>}) {
  const [open, setOpen] = useState(false),
    [staff, setStaff] = useState(lead.profile?.staff || []),
    [images, setImages] = useState(lead.profile?.images || []),
    [reviews, setReviews] = useState(lead.profile?.reviews || []),
    [assetsDirty, setAssetsDirty] = useState(false),
    [notes, setNotes] = useState(lead.researchNotes),
    [socials, setSocials] = useState(lead.profile?.onlinePresence || []),
    [socialDirty, setSocialDirty] = useState(false),
    [address, setAddress] = useState(lead.profile?.address || ""),
    [maps, setMaps] = useState(lead.profile?.googleMapsUrl || ""),
    [mapsType, setMapsType] = useState(lead.profile?.googleMapsLinkType || "search"),
    [addressNotes, setAddressNotes] = useState(lead.profile?.addressNotes || ""),
    [hours, setHours] = useState(lead.profile?.openingHours || ""),
    [email, setEmail] = useState(lead.profile?.publicEmail || ""),
    [services, setServices] = useState(lead.profile?.services?.join("\n") || ""),
    [source, setSource] = useState(lead.profile?.sourceUrl || ""),
    [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const profileChanged = assetsDirty || socialDirty || maps !== (lead.profile?.googleMapsUrl || "") || mapsType !== (lead.profile?.googleMapsLinkType || "search") || addressNotes !== (lead.profile?.addressNotes || "") || address !== (lead.profile?.address || "") || hours !== (lead.profile?.openingHours || "") || email !== (lead.profile?.publicEmail || "") || services !== (lead.profile?.services?.join("\n") || "") || source !== (lead.profile?.sourceUrl || "");
      if (mapsType === "listing" && !maps.trim()) throw new Error("Add the verified Google Maps listing URL, or choose search.");
      if (profileChanged && !source.trim()) throw new Error("Add the source URL for the business details.");
      await api(`/leads/${lead.id}/content`, "PATCH", {expectedVersion:lead.version, researchNotes:notes,
        ...(profileChanged ? {profile:{...lead.profile, ...(assetsDirty ? {staff, images, reviews} : {}), ...(socialDirty ? {onlinePresence:socials} : {}), address, addressNotes, googleMapsUrl:maps.trim() || mapsUrl({...lead, profile:{...lead.profile, ...(socialDirty ? {onlinePresence:socials} : {}), address, sourceUrl:source, observedAt:new Date().toISOString(), googleMapsUrl:undefined}}), googleMapsLinkType:mapsType, openingHours:hours, ...(email.trim() ? {publicEmail:email.trim()} : {publicEmail:undefined}), services:services.split("\n").map(x=>x.trim()).filter(Boolean), sourceUrl:source.trim(), observedAt:new Date().toISOString()}} : {})});
      await refresh(); setOpen(false);
    } catch(e) { setError((e as Error).message); } finally {setBusy(false);}
  }
  return <View style={s.section}>
    <Button subtle label={open ? "Cancel profile edits" : "Edit business details"} icon="edit-2" disabled={busy} onPress={()=>setOpen(!open)} />
    {open && <>
      <Text style={s.body}>Keep details factual and include their source. Changes are saved with your name in the activity history.</Text>
      <Field label="Published business address / service area" value={address} onChangeText={setAddress} />
      <Field label="Address notes · source, uncertainty or service area only" multiline value={addressNotes} onChangeText={setAddressNotes} />
      <Field label="Google Maps URL" value={maps} onChangeText={setMaps} />
      <Choices values={["search", "listing"]} value={mapsType} onChange={(value)=>setMapsType(value as "search" | "listing")} />
      <Field label="Public business email" value={email} onChangeText={setEmail} />
      <Field label="Opening hours" multiline value={hours} onChangeText={setHours} />
      <Field label="Services · one per line" multiline value={services} onChangeText={setServices} />
      <Field label="Business details source URL" value={source} onChangeText={setSource} />
      <Text style={s.h2}>Social profiles</Text>
      <Text style={s.body}>Record the business profile URL and evidence. Leave unresearched platforms as Not checked. Website findings are edited with Update website review.</Text>
      {socialPlatforms.map(platform=>{
        const saved=socials.find(p=>p.platform===platform);
        const inferred=onlinePresence(lead).find(p=>p.platform===platform)!;
        const current=saved || {platform,status:inferred.status,url:inferred.url,sourceUrl:inferred.sourceUrl || lead.profile?.sourceUrl || lead.sources[0]?.url || "",checkedAt:new Date().toISOString(),notes:inferred.notes};
        const change=(patch:Partial<typeof current>)=>{setSocialDirty(true);setSocials(old=>[...old.filter(p=>p.platform!==platform),{...current,...patch,checkedAt:new Date().toISOString()}]);};
        return <View key={platform} style={{gap:8,paddingVertical:8}}>
          <Text style={s.h2}>{platform}</Text>
          <Choices values={["Not checked","Found","Not found"]} value={current.status} onChange={status=>change({status:status as typeof current.status,url:status === "Found" ? current.url : undefined})} />
          {current.status === "Found" && <Field label={`${platform} profile URL`} value={current.url || ""} onChangeText={url=>change({url,sourceUrl:current.sourceUrl || url})} />}
          {(saved || current.status !== "Not checked") && <>
            <Field label={`${platform} evidence source URL`} value={current.sourceUrl} onChangeText={sourceUrl=>change({sourceUrl})} />
            <Field label={`${platform} search notes`} value={current.notes || ""} onChangeText={notes=>change({notes})} />
          </>}
        </View>;
      })}
      <Text style={s.h2}>People mentioned in reviews</Text>
      <Text style={s.body}>Only record people explicitly described as working for the business. Include the supporting review excerpt and source.</Text>
      {staff.map((person,i)=><View key={i} style={s.card}>
        <Field label="Staff name" value={person.name} onChangeText={name=>{setAssetsDirty(true);setStaff(staff.map((p,j)=>j===i?{...p,name}:p));}} />
        <Field label="Role (if stated)" value={person.role || ""} onChangeText={role=>{setAssetsDirty(true);setStaff(staff.map((p,j)=>j===i?{...p,role}:p));}} />
        <Field label="Supporting review excerpt" multiline value={person.excerpt} onChangeText={excerpt=>{setAssetsDirty(true);setStaff(staff.map((p,j)=>j===i?{...p,excerpt}:p));}} />
        <Field label="Staff review source URL" value={person.sourceUrl} onChangeText={sourceUrl=>{setAssetsDirty(true);setStaff(staff.map((p,j)=>j===i?{...p,sourceUrl}:p));}} />
        <Button subtle label="Remove person" onPress={()=>{setAssetsDirty(true);setStaff(staff.filter((_,j)=>j!==i));}} />
      </View>)}
      <Button subtle label="Add staff mention" disabled={staff.length>=20} onPress={()=>{setAssetsDirty(true);setStaff([...staff,{name:"",excerpt:"",sourceUrl:""}]);}} />
      <Text style={s.h2}>Photos from reviews & business</Text>
      {images.map((photo,i)=><View key={i} style={s.card}>
        <Field label="Photo URL" value={photo.url} onChangeText={url=>{setAssetsDirty(true);setImages(images.map((p,j)=>j===i?{...p,url}:p));}} />
        <Field label="Photo caption" value={photo.caption} onChangeText={caption=>{setAssetsDirty(true);setImages(images.map((p,j)=>j===i?{...p,caption}:p));}} />
        <Field label="Photo source / review URL" value={photo.sourceUrl} onChangeText={sourceUrl=>{setAssetsDirty(true);setImages(images.map((p,j)=>j===i?{...p,sourceUrl}:p));}} />
        <Button subtle label="Remove photo" onPress={()=>{setAssetsDirty(true);setImages(images.filter((_,j)=>j!==i));}} />
      </View>)}
      <Button subtle label="Add photo" disabled={images.length>=10} onPress={()=>{setAssetsDirty(true);setImages([...images,{url:"",caption:"",sourceUrl:""}]);}} />
      <Text style={s.h2}>Review excerpts</Text>
      {reviews.map((review,i)=><View key={i} style={s.card}>
        <Field label="Review text" multiline value={review.text} onChangeText={text=>{setAssetsDirty(true);setReviews(reviews.map((p,j)=>j===i?{...p,text}:p));}} />
        <Field label="Review author" value={review.author} onChangeText={author=>{setAssetsDirty(true);setReviews(reviews.map((p,j)=>j===i?{...p,author}:p));}} />
        <Field label="Review source URL" value={review.sourceUrl} onChangeText={sourceUrl=>{setAssetsDirty(true);setReviews(reviews.map((p,j)=>j===i?{...p,sourceUrl}:p));}} />
        <Button subtle label="Remove review" onPress={()=>{setAssetsDirty(true);setReviews(reviews.filter((_,j)=>j!==i));}} />
      </View>)}
      <Button subtle label="Add review" disabled={reviews.length>=10} onPress={()=>{setAssetsDirty(true);setReviews([...reviews,{text:"",author:"",sourceUrl:""}]);}} />
      <Field label="Research notes" multiline value={notes} onChangeText={setNotes} />
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Button label={busy ? "Saving…" : "Save business details"} disabled={busy} onPress={()=>void save()} />
    </>}
  </View>;
}
