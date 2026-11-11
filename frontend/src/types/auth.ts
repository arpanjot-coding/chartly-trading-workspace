export interface User {
  username: string
  broker?: string
  isLoggedIn: boolean
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface LoginResponse {
  status: 'success' | 'error'
  message?: string
}

export interface TOTPCredentials {
  totp: string
  userid?: string
  password?: string
  apikey?: string
  apisecret?: string
}
