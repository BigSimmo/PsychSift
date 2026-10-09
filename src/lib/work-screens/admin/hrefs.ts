/** The wiring thread's Admin routes. Icon-free, like `ADMIN_PAGE_HREFS`, so a link costs nothing. */
export const ADMIN_WORK_SCREEN_HREFS = {
  requests: "/admin/requests",
  sharing: "/admin/sharing",
  documents: "/admin/documents",
  pay: "/admin/pay",
  tax: "/admin/tax",
  workforce: "/admin/workforce",
  bookings: "/admin/bookings",
  myBookings: "/admin/bookings?view=mine",
  bookingCourse: (courseId: string) => `/admin/bookings?course=${encodeURIComponent(courseId)}`,
  courses: "/admin/courses",
  postCourse: "/admin/courses?new=1",
  organiserCourse: (courseId: string) => `/admin/courses?course=${encodeURIComponent(courseId)}`,
} as const;
