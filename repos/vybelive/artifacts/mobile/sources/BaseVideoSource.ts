import type {
  IVideoSource,
  VideoSourceCapabilities,
  VideoSourceConfig,
  VideoSourceState,
  VideoSourceStateChangeHandler,
  VideoSourceType,
} from "@/types/videoSource";

/**
 * Abstract base for all video source implementations.
 * Handles listener management and the _setState helper so concrete
 * sources only need to implement connect(), disconnect(), and declare
 * their readonly metadata fields.
 */
export abstract class BaseVideoSource implements IVideoSource {
  abstract readonly type: VideoSourceType;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly capabilities: VideoSourceCapabilities;

  protected _state: VideoSourceState = { status: "idle" };
  private readonly _listeners = new Set<VideoSourceStateChangeHandler>();

  get state(): VideoSourceState {
    return this._state;
  }

  /** Update state and notify all subscribers. */
  protected _setState(update: Partial<VideoSourceState>): void {
    this._state = { ...this._state, ...update };
    for (const handler of this._listeners) {
      handler(this._state);
    }
  }

  onStateChange(handler: VideoSourceStateChangeHandler): () => void {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  abstract connect(config?: VideoSourceConfig): Promise<void>;
  abstract disconnect(): Promise<void>;
}
