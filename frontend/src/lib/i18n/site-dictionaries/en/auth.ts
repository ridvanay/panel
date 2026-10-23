/**
 * Paket O (2026-10-23) — giriş / kayıt / şifre / e-posta doğrulama / 2FA ekranları ve doktor girişi.
 * Dil, proxy'nin belirlediği aktif dilden gelir (`next` öneki → dil çerezi → Accept-Language →
 * varsayılan). `{name}` yer tutucuları `fmt()` ya da `splitTemplate()` ile doldurulur.
 */
export const authStrings = {
  login: {
    title: "Sign in",
    subtitle: "Enter your details to access your account.",
    noAccount: "Don't have an account?",
    registerLink: "Sign up",
    email: "Email",
    password: "Password",
    forgotPassword: "Forgot your password?",
    submit: "Sign in",
    twoFactorTitle: "Two-step verification",
    twoFactorHelp:
      "This is not an email code. Enter the 6-digit code shown in your authenticator app (e.g. Google Authenticator) or a backup code.",
    authenticatorCode: "Authenticator code",
    codePlaceholder: "123456 or XXXX-XXXX",
    verify: "Verify",
    back: "Back",
    notADoctor:
      "This account is not linked to a doctor profile. Only accounts linked to a registered doctor profile can access the doctor portal.",
    backToSite: "Back to the main site",
  },
  register: {
    title: "Create an account",
    subtitle: "Get started in seconds, no credit card required.",
    haveAccount: "Already have an account?",
    loginLink: "Sign in",
    name: "Full name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 8 characters.",
    submit: "Create account",
  },
  forgot: {
    title: "Forgot password",
    subtitle: "We'll send a reset link to your email address.",
    backToLogin: "Back to sign in",
    sentNotice: "If an account is registered with this email address, you will shortly receive a password reset link.",
    email: "Email",
    submit: "Send reset link",
  },
  reset: {
    title: "Set a new password",
    invalidLink: "The link is invalid. Please use the link in the reset email again.",
    newPassword: "New password",
    passwordHint: "At least 8 characters.",
    submit: "Update password",
    backToLogin: "Back to sign in",
  },
  verify: {
    title: "Verify your email",
    subtitle: "Enter the code we sent to your email to activate your account.",
    wrongAccount: "Wrong account?",
    backToLogin: "Back to sign in",
    codeSentTo: "Enter the 6-digit code sent to {email}.",
    expiresSoon: "The code expires shortly.",
    invalidCode: "The code is incorrect or has expired. Please request a new one.",
    notRegisteredHint: "If you have not registered with this email, or your registration is already complete, try the {register} or {login} pages.",
    registerLink: "Sign up",
    loginLink: "Sign in",
    codeLabel: "Verification code",
    submit: "Verify",
    resendIn: "You can resend in {seconds} seconds",
    resendAgain: "Resend code",
    sendCode: "Send code",
    resendNotice: "If a new code was sent, it will reach your inbox within a few minutes.",
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type AuthStrings = Widen<typeof authStrings>;
