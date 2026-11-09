import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getErrorMessage } from "../getErrorMessage.js"
import { queryKeys } from "../queryKeys.js"

const getSessionUser = async () => {
  const { completeGoogleSignIn } = await import("./auth.js")
  return completeGoogleSignIn()
}

export function useAuthSession() {
  const queryClient = useQueryClient()
  const userQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getSessionUser,
  })

  const signInMutation = useMutation({
    mutationFn: async () => {
      const { loginWithGoogle } = await import("./auth.js")
      return loginWithGoogle()
    },
    onSuccess: (user) => {
      if (user) queryClient.setQueryData(queryKeys.currentUser, user)
    },
  })

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { logout } = await import("./auth.js")
      return logout()
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.currentUser, null)
      queryClient.removeQueries({ queryKey: ["conversations"] })
    },
  })

  const mutateSignIn = signInMutation.mutate
  const mutateSignOut = signOutMutation.mutateAsync
  const resetSignIn = signInMutation.reset
  const resetSignOut = signOutMutation.reset
  const signIn = useCallback(
    () => mutateSignIn(),
    [mutateSignIn],
  )
  const signOut = useCallback(async () => {
    try {
      await mutateSignOut()
      return true
    } catch {
      return false
    }
  }, [mutateSignOut])
  const clearError = useCallback(() => {
    resetSignIn()
    resetSignOut()
  }, [resetSignIn, resetSignOut])

  const error =
    signInMutation.error ??
    signOutMutation.error ??
    signOutMutation.data?.backendError ??
    userQuery.error

  return {
    user: userQuery.data ?? null,
    isLoadingUser: userQuery.isPending,
    isSigningIn: signInMutation.isPending,
    isSigningOut: signOutMutation.isPending,
    error: error
      ? getErrorMessage(error, "An authentication error occurred.")
      : "",
    signIn,
    signOut,
    clearError,
  }
}
