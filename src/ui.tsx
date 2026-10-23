import React, { useState } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  StyleSheet,
  TextInputProps,
  Linking,
  Modal,
  ScrollView,
} from "react-native";
import type { Lead } from "./types";
import { onlinePresence, socialPlatforms } from "./presence";
import brandGlyphs from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/FontAwesome6Free.json";
import createIconSet from "@expo/vector-icons/createIconSet";
import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json";
const Feather = createIconSet(glyphMap, "daniboy-feather", require("../assets/Feather.ttf"));
export const colors = {
  ink: "#152a27",
  muted: "#72807b",
  line: "#e1e8e3",
  green: "#1d6951",
  pale: "#edf4ee",
  bg: "#f7f9f5",
  amber: "#956c20",
};
export function Icon({
  name,
  size = 18,
  color = colors.muted,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
export function Button({
  label,
  onPress,
  subtle = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  subtle?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }: any) => [
        s.button,
        subtle && s.subtle,
        disabled && { opacity: 0.45 },
        hovered && { opacity: 0.8 },
      ]}
    >
      {icon && (
        <Icon name={icon} size={16} color={subtle ? colors.ink : "#fff"} />
      )}
      <Text
        style={{
          color: subtle ? colors.ink : "#fff",
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 7, flexGrow: 1 }}>
      {label && <Text style={s.label}>{label}</Text>}
      <TextInput
        accessibilityLabel={label || props.placeholder}
        placeholderTextColor="#8a9690"
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 90, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Badge({ text }: { text: string }) {
  const green = [
    "Interested",
    "Owner confirmed no website",
    "completed",
  ].includes(text);
  const amber = ["Uncertain", "blocked", "Follow up"].includes(text);
  return (
    <View
      style={[
        s.badge,
        { backgroundColor: green ? "#e2f1e8" : amber ? "#fbf0d9" : "#edf1ee" },
      ]}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: green ? colors.green : amber ? colors.amber : colors.muted,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
export function Choices({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
      {values.map((v) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: v === value }}
          onPress={() => onChange(v)}
          key={v}
          style={[
            s.chip,
            v === value && {
              borderColor: colors.green,
              backgroundColor: "#e6f0e8",
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              color: v === value ? colors.green : colors.muted,
            }}
          >
            {v}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function FilterSelect({ label, values, value, onChange }: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ expanded: open }} onPress={() => { setSearch(""); setOpen(true); }}
      style={[s.input, { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10 }]}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.ink }}>{label}: {value}</Text>
      <Icon name="chevron-down" size={15} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss options" onPress={() => setOpen(false)}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(21,42,39,0.3)" }]} />
        <View accessibilityViewIsModal style={[s.card, { width: "100%", maxWidth: 440, maxHeight: "80%", padding: 18, gap: 12 }]}>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Text style={s.h2}>{label}</Text>
            <Button label="Close" subtle onPress={() => setOpen(false)} />
          </View>
          {values.length > 7 && <Field placeholder={`Search ${label.toLowerCase()}…`} value={search} onChangeText={setSearch} autoFocus />}
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {values.filter(option => option.toLowerCase().includes(search.toLowerCase())).map(option =>
              <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: option === value }}
                onPress={() => { onChange(option); setOpen(false); }}
                style={{ padding: 13, minHeight: 44, borderRadius: 6, backgroundColor: option === value ? colors.pale : "#fff", flexDirection: "row", gap: 12, alignItems: "center" }}>
                <Text style={{ flex: 1, fontSize: 14, color: option === value ? colors.green : colors.ink }}>{option}</Text>
                {option === value && <Icon name="check" color={colors.green} size={16} />}
              </Pressable>)}
            {!values.some(option => option.toLowerCase().includes(search.toLowerCase())) && <Text style={s.body}>No matching options.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
export function ExternalLink({ url, label }: { url: string; label?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        if (/^https?:\/\//.test(url)) void Linking.openURL(url);
      }}
    >
      <Text
        style={{
          color: colors.green,
          fontSize: 13,
          lineHeight: 20,
          textDecorationLine: "underline",
        }}
      >
        {label || url}
      </Text>
    </Pressable>
  );
}
export const s = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  subtle: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.line },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 5,
    alignSelf: "flex-start",
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  h1: {
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: -0.8,
    color: colors.ink,
  },
  h2: { fontSize: 18, fontWeight: "600", color: colors.ink },
  body: { fontSize: 13, lineHeight: 21, color: colors.muted },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 22,
    gap: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: {
    backgroundColor: "#fcece5",
    borderRadius: 8,
    padding: 13,
    color: "#9c4027",
    fontSize: 13,
    lineHeight: 20,
  },
  section: {
    gap: 12,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});

const Brands = createIconSet(brandGlyphs, "daniboy-brands", require("../assets/FontAwesome6_Brands.ttf"));
const socialIcons = {
  Instagram: {name:"instagram",color:"#E4405F"}, Facebook:{name:"facebook",color:"#1877F2"},
  LinkedIn:{name:"linkedin",color:"#0A66C2"}, TikTok:{name:"tiktok",color:"#111111"},
  YouTube:{name:"youtube",color:"#FF0000"}, X:{name:"x-twitter",color:"#111111"},
  Nextdoor:{name:"square-letterboxd",color:"#15803D"}, Yelp:{name:"yelp",color:"#D32323"},
} as const;
export function SocialLinks({lead}:{lead:Lead}) {
  const presence = onlinePresence(lead);
  return <View style={{flexDirection:"row", flexWrap:"wrap", gap:8}}>
    {socialPlatforms.map(platform=>{
      const entry=presence.find(p=>p.platform===platform)!;
      const found=entry.status === "Found" && !!entry.url;
      const icon=socialIcons[platform];
      return <Pressable key={platform} accessibilityRole={found ? "link" : "image"} accessibilityLabel={`${platform} · ${entry.status}`} disabled={!found} onPress={event=>{event.stopPropagation();void Linking.openURL(entry.url!);}} style={{padding:8,opacity:found?1:0.25}}>
        {platform === "Nextdoor" ? <Icon name="home" size={22} color={icon.color} /> : <Brands name={icon.name} size={22} color={icon.color} />}
      </Pressable>;
    })}
  </View>;
}
