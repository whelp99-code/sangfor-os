export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    timestamp: number;
  };
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  statusCode: number;
}
