// A new request or context invalidates all earlier responses, including a
// date changed away and back to the same value while a save is in flight.
export function createAttendanceRequests() {
  let generation = 0
  return {
    invalidate() { generation += 1 },
    begin() {
      const request = ++generation
      return () => request === generation
    },
  }
}
