export function canReadJobEvents(params: {
  requestedProjectId: string;
  eventProjectId: string | null;
}) {
  if (!params.eventProjectId) {
    return false;
  }

  return params.requestedProjectId === params.eventProjectId;
}
