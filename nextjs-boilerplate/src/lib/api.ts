import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

// Prázdný default = same-origin requesty. Browser pošle GET /api/X na origin
// kde běží frontend, takže nemusíme řešit změnu portu při dev. Přepiš jen
// pokud je API na jiné doméně (production cross-origin setup).
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
}

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false,
});

api.interceptors.request.use(
  (config: CustomAxiosRequestConfig) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error: unknown) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: unknown) => {
    const axiosError = error as AxiosError;
    const config = axiosError.config as CustomAxiosRequestConfig;

    if (!config) {
      return Promise.reject(axiosError);
    }

    if (axiosError.response?.status === 401) {
      config.retryCount = config.retryCount || 0;

      if (config.retryCount < 1) {
        config.retryCount += 1;

        try {
          const refreshResponse = await axios.post(`${API_URL}/api/auth/refresh`, {
            headers: {
              Cookie: document.cookie,
            },
          });

          const { accessToken } = refreshResponse.data;

          if (typeof window !== 'undefined') {
            localStorage.setItem('accessToken', accessToken);
          }

          config.headers.Authorization = `Bearer ${accessToken}`;
          return api(config);
        } catch (refreshError: unknown) {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken');
            window.location.href = '/login';
          }

          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(axiosError);
  }
);

export default api;
