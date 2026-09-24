export function useWeeklyGridWindow() {
  return {
    window: { workingDays: [0, 1, 2, 3, 4, 5], startHour: 8, endHour: 16 },
    isLoading: false,
  };
}
