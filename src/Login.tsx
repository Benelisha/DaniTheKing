import React, { useState } from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { GoogleAuthProvider, signInWithPopup, sendEmailVerification, signOut } from "firebase/auth";
import { auth, firebaseConfigured } from "./firebase";
import { Button, Icon, s, colors } from "./ui";
export function Login({ accessError = "" }: { accessError?: string }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();
  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!firebaseConfigured) throw new Error("Firebase configuration is missing.");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError(code === "auth/popup-blocked"
          ? "Allow pop-ups for this site, then try again."
          : code === "auth/network-request-failed"
            ? "Could not connect. Check your connection and try again."
            : "Google sign-in could not be completed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        flexDirection: width > 850 ? "row" : "column",
      }}
    >
      {width > 850 && (
        <View
          style={{
            flex: 1,
            backgroundColor: "#153d33",
            padding: 64,
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontSize: 27, color: "#fff", fontWeight: "700" }}>
            dani<Text style={{ color: "#acdcb3" }}>boy</Text>
            <Text style={{ color: "#acdcb3" }}> .</Text>
          </Text>
          <View style={{ gap: 24 }}>
            <View
              style={{
                height: 60,
                width: 60,
                borderRadius: 18,
                backgroundColor: "#2c5347",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="compass" size={30} color="#b9e4bc" />
            </View>
            <Text
              style={{
                fontSize: 49,
                lineHeight: 57,
                color: "#f5f8ed",
                fontWeight: "600",
                letterSpacing: -1.5,
              }}
            >
              Good businesses.{"\n"}New possibilities.
            </Text>
            <Text
              style={{
                fontSize: 16,
                lineHeight: 27,
                color: "#b5ccc2",
                maxWidth: 400,
              }}
            >
              Find local service businesses, check the evidence, and turn your
              next call into a conversation.
            </Text>
          </View>
          <Text style={{ color: "#8eafa0", fontSize: 12 }}>
            DANIBOY / TEAM WORKSPACE
          </Text>
        </View>
      )}
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <View style={{ maxWidth: 380, width: "100%", gap: 22 }}>
          <Text
            style={{
              fontSize: 12,
              letterSpacing: 2,
              color: colors.green,
              fontWeight: "600",
            }}
          >
            WELCOME TO DANIBOY
          </Text>
          <View style={{ gap: 9 }}>
            <Text style={s.h1}>
              A better starting point.
            </Text>
            <Text style={s.body}>
              Sign in with Google using your approved team email. This workspace is private to Ben and Daniel.
            </Text>
          </View>
          {!!(error || accessError) && (
            <Text accessibilityRole="alert" style={s.error}>
              {error || accessError}
            </Text>
          )}
          <Button
            label={busy ? "Signing in…" : "Continue with Google"}
            onPress={() => void submit()}
            disabled={busy}
          />
          <Text style={s.body}>
            Other accounts are automatically signed out and cannot access business data.
          </Text>
          <View style={[s.row, { marginTop: 18 }]}>
            <Icon name="lock" size={14} />
            <Text style={{ fontSize: 12, color: colors.muted }}>
              Access is checked securely on every request.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
export function VerifyEmail({ onVerified }: { onVerified: () => void }) {
  const [message, setMessage] = useState("");
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: colors.bg,
        padding: 30,
      }}
    >
      <View style={[s.card, { maxWidth: 460, width: "100%" }]}>
        <Icon name="mail" size={30} color={colors.green} />
        <Text style={s.h2}>Verify your email</Text>
        <Text style={s.body}>
          Open the verification link sent to {auth.currentUser?.email}. Your
          leads stay private until your email is verified.
        </Text>
        <Button
          label="I’ve verified my email"
          onPress={() => {
            void (async () => {
              await auth.currentUser?.reload();
              await auth.currentUser?.getIdToken(true);
              if (auth.currentUser?.emailVerified) onVerified();
              else
                setMessage("Your email is still unverified. Check your inbox.");
            })().catch((e) => setMessage(e.message));
          }}
        />
        <Button
          subtle
          label="Resend verification email"
          onPress={() => {
            if (auth.currentUser)
              void sendEmailVerification(auth.currentUser)
                .then(() => setMessage("Verification email sent."))
                .catch((e) => setMessage(e.message));
          }}
        />
        {!!message && <Text style={s.body}>{message}</Text>}
        <Button subtle label="Sign out" onPress={() => void signOut(auth)} />
      </View>
    </View>
  );
}
