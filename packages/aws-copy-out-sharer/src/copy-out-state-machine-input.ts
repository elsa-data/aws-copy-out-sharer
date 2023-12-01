export type CopyOutStateMachineInput = {
  maxItemsPerBatch: number;
  requiredRegion: string;

  sourceFilesCsvBucket: string;
  sourceFilesCsvKey: string;

  destinationKey: string;
};

export type CopyOutStateMachineInputKeys = keyof CopyOutStateMachineInput;
