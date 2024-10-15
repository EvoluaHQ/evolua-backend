export class EvoluaStackProps {
  stageName: string;
  ssmStageName: string;
}

export class EvoluaServiceStackProps extends EvoluaStackProps {
  serviceName: string;
}
