import { PortalStatus } from '../gst/portalDetector';
import { QueueJob, QueueState } from '../queue/queueTypes';
import { DownloadItemInfo } from '../downloads/downloadMonitor';

export type ExtensionMessageType =
  | 'GET_PORTAL_STATUS'
  | 'PORTAL_STATUS'
  | 'GET_QUEUE'
  | 'QUEUE_UPDATED'
  | 'ADD_TEST_JOB'
  | 'START_QUEUE'
  | 'PAUSE_QUEUE'
  | 'RESUME_QUEUE'
  | 'RETRY_JOB'
  | 'REMOVE_JOB'
  | 'CLEAR_COMPLETED'
  | 'CLEAR_ALL'
  | 'DOWNLOAD_DETECTED'
  | 'DOWNLOAD_UPDATED'
  | 'TRIGGER_TEST_DOWNLOAD'
  | 'PING';

export interface BaseMessage {
  type: ExtensionMessageType;
}

export interface GetPortalStatusMessage extends BaseMessage {
  type: 'GET_PORTAL_STATUS';
}

export interface PortalStatusMessage extends BaseMessage {
  type: 'PORTAL_STATUS';
  status: PortalStatus;
}

export interface GetQueueMessage extends BaseMessage {
  type: 'GET_QUEUE';
}

export interface QueueUpdatedMessage extends BaseMessage {
  type: 'QUEUE_UPDATED';
  state: QueueState;
}

export interface AddTestJobMessage extends BaseMessage {
  type: 'ADD_TEST_JOB';
  jobData?: Partial<QueueJob>;
}

export interface StartQueueMessage extends BaseMessage {
  type: 'START_QUEUE';
}

export interface PauseQueueMessage extends BaseMessage {
  type: 'PAUSE_QUEUE';
}

export interface ResumeQueueMessage extends BaseMessage {
  type: 'RESUME_QUEUE';
}

export interface RetryJobMessage extends BaseMessage {
  type: 'RETRY_JOB';
  jobId: string;
}

export interface RemoveJobMessage extends BaseMessage {
  type: 'REMOVE_JOB';
  jobId: string;
}

export interface ClearCompletedMessage extends BaseMessage {
  type: 'CLEAR_COMPLETED';
}

export interface ClearAllMessage extends BaseMessage {
  type: 'CLEAR_ALL';
}

export interface DownloadDetectedMessage extends BaseMessage {
  type: 'DOWNLOAD_DETECTED';
  download: DownloadItemInfo;
}

export interface TriggerTestDownloadMessage extends BaseMessage {
  type: 'TRIGGER_TEST_DOWNLOAD';
  filename?: string;
  associatedJobId?: string;
}

export type ExtensionMessage =
  | GetPortalStatusMessage
  | PortalStatusMessage
  | GetQueueMessage
  | QueueUpdatedMessage
  | AddTestJobMessage
  | StartQueueMessage
  | PauseQueueMessage
  | ResumeQueueMessage
  | RetryJobMessage
  | RemoveJobMessage
  | ClearCompletedMessage
  | ClearAllMessage
  | DownloadDetectedMessage
  | TriggerTestDownloadMessage;
