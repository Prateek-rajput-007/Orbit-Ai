import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth"
import api from "../../api/api.js"
import { auth } from "../../config/firebase.js"

const createBackendSession = async (firebaseUser) => {
  const idToken = await firebaseUser.getIdToken()
  const { data } = await api.post("/api/auth/login", { idToken })
  if (!data?.user) {
    throw new Error("The server did not return a user after Firebase sign-in.")
  }
  return data.user
}

export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: "select_account" })

  try {
    const credential = await signInWithPopup(auth, provider)
    return await createBackendSession(credential.user)
  } catch (error) {
    if (
      error?.code === "auth/popup-blocked" ||
      error?.code === "auth/operation-not-supported-in-this-environment"
    ) {
      return signInWithRedirect(auth, provider)
    }
    throw error
  }
}

export const completeGoogleSignIn = async () => {
  await auth.authStateReady()
  let credential
  try {
    credential = await getRedirectResult(auth)
  } catch (error) {
    if (!auth.currentUser) throw error
  }
  const firebaseUser = credential?.user ?? auth.currentUser
  if (!firebaseUser) return null

  return createBackendSession(firebaseUser)
}

export const logout = async () => {
  let backendError
  try {
    await api.get("/api/auth/logout")
  } catch (error) {
    backendError = error
  }

  await signOut(auth)

  return { backendError }
}
