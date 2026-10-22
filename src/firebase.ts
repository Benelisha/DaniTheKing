import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
export const firebaseConfigured = !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "not-configured",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
});
export const auth = getAuth(app);
if (
  process.env.EXPO_PUBLIC_USE_EMULATORS === "true" &&
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.startsWith("demo-")
)
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
export const allowedEmails = ["daniel@alined.dev", "doron.elisha@gmail.com"];
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in.");
  const response = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL || "/api"}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The backend is not available yet. Firebase Functions deployment must be completed.",
    );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "The request failed.");
  return data;
}
