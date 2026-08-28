export type AuthUser = {
  id: string;
  email: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  permissions: string[];
};

export type ApiSuccess<T> = {
  success: true;
  message: string;
  data: T;
};

export type ApiFailure = {
  success: false;
  message: string;
  data: null | { errors?: unknown };
};

export type Paged<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
