function resolveApiUrl() {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";

    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return "http://localhost:5000/api";
    }

    if (host.includes("onrender.com") || host.includes("render.com")) {
      return "https://barberbro-1.onrender.com/api";
    }
  }

  return import.meta.env.VITE_API_URL || "https://barberbro-1.onrender.com/api";
}

const API_URL = resolveApiUrl();

const TOKEN_KEY = "barberbro_admin_token";

export function subscribeToUpdates(token, onUpdate, onStatus, onUnauthorized) {
  let active = true;
  let controller;
  let retryTimer;
  let retryResolver;

  async function connect() {
    onStatus("connecting");

    while (active) {
      controller = new AbortController();

      try {
        const response = await fetch(`${API_URL}/events`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (response.status === 401) {
          onUnauthorized();
          return;
        }
        if (!response.ok || !response.body) {
          throw new Error(`Realtime connection failed (${response.status})`);
        }

        onStatus("connected");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            const messages = buffer.split("\n\n");
            buffer = messages.pop() || "";

            for (const message of messages) {
              if (message.split("\n").some((line) => line === "event: update")) {
                onUpdate();
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        if (active) onStatus("reconnecting");
      } catch (error) {
        if (!active || error.name === "AbortError") return;
        onStatus("reconnecting");
      }

      if (!active) return;
      await new Promise((resolve) => {
        retryResolver = resolve;
        retryTimer = window.setTimeout(resolve, 3000);
      });
      retryResolver = null;
      retryTimer = null;
    }
  }

  connect();

  return () => {
    active = false;
    controller?.abort();
    window.clearTimeout(retryTimer);
    retryResolver?.();
  };
}

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
    cache: "no-store",
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
  login: (username, password) =>
    request("/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
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

  getBarbers: () => request("/barbers/admin"),

  getBarberStats: () => request("/barbers/stats"),

  addBarber: (barber) =>
    request("/barbers", {
      method: "POST",
      body: JSON.stringify(barber),
    }),

  updateBarber: (barberId, barber) =>
    request(`/barbers/${barberId}`, {
      method: "PUT",
      body: JSON.stringify(barber),
    }),

  deleteBarber: (barberId) =>
    request(`/barbers/${barberId}`, {
      method: "DELETE",
    }),

  getRewardTemplates: () => request("/reward-templates/admin"),

  getRewardRedemptions: () => request("/reward-redemptions"),

  getHaircutStyles: () => request("/haircut-styles"),

  addHaircutStyle: (style) =>
    request("/haircut-styles", {
      method: "POST",
      body: JSON.stringify(style),
    }),

  deleteHaircutStyle: (styleId) =>
    request(`/haircut-styles/${styleId}`, {
      method: "DELETE",
    }),

  addRewardTemplate: (reward) =>
    request("/reward-templates", {
      method: "POST",
      body: JSON.stringify(reward),
    }),

  updateRewardTemplate: (rewardId, reward) =>
    request(`/reward-templates/${rewardId}`, {
      method: "PUT",
      body: JSON.stringify(reward),
    }),

  deleteRewardTemplate: (rewardId) =>
    request(`/reward-templates/${rewardId}`, {
      method: "DELETE",
    }),

  recordVisit: (visit) =>
    request("/visits", {
      method: "POST",
      body: JSON.stringify(visit),
    }),

  createActivationCode: (customerId) =>
    request(`/customers/${customerId}/activation-code`, {
      method: "POST",
    }),

  resendActivationEmail: (customerId) =>
    request(`/customers/${customerId}/activation-code/resend`, {
      method: "POST",
    }),

  deleteCustomer: (customerId) =>
    request(`/customers/${customerId}`, {
      method: "DELETE",
    }),

};
