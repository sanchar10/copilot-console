import type { Pin, CreatePinRequest, UpdatePinRequest } from '../types/pin';

const API_BASE = '/api';

export async function listPins(sessionId: string): Promise<Pin[]> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/pins`);
  if (!response.ok) {
    throw new Error('Failed to list pins');
  }
  const data: { pins: Pin[] } = await response.json();
  return data.pins || [];
}

export async function createPin(sessionId: string, request: CreatePinRequest): Promise<Pin> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to create pin');
  }
  return response.json();
}

export async function updatePin(sessionId: string, pinId: string, request: UpdatePinRequest): Promise<Pin> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/pins/${pinId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to update pin');
  }
  return response.json();
}

export async function deletePin(sessionId: string, pinId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/pins/${pinId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to delete pin');
  }
}
