const API_URL =
  import.meta.env.VITE_API_URL || "https://barberbro-1.onrender.com/api";

const TOKEN_KEY = "barberbro_admin_token";

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function saveAdminToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(endpoint, options = {}) {
  const token = getAdminToken();

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
                  ...( token ? { Authorization: "Bearer " + token } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    clearAdminToken();
    window.dispatchEvent(new Event("barberbro-admin-unauthorized"));
  }

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }

  return data;
}

export const api = {
  login: (email, password) =>
    request("/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getDashboard: () => request("/dashboard"),

  getCustomers: (search = "") =>
    request(`/customers?search=${encodeURIComponent(search)}`),

  addCustomer: (customer) =>
    request("/customers", {
      method: "POST",
      body: JSON.stringify(customer),
    }),

  getVisits: () => request("/visits"),

  recordVisit: (visit) =>
    request("/visits", {
      method: "POST",
      body: JSON.stringify(visit),
    }),

  redeemReward: (customerId) =>
    request(`/customers/${customerId}/redeem`, {
      method: "POST",
    }),

  createActivationCode: (customerId) =>
    request(`/customers/${customerId}/activation-code`, {
      method: "POST",
    }),

  deleteCustomer: (customerId) =>
    request(`/customers/${customerId}`, {
      method: "DELETE",
    }),

  lookupCustomerByQr: (qrPayload) =>
    request("/customers/lookup", {
      method: "POST",
      body: JSON.stringify({ qr_payload: qrPayload }),
    }),
};
