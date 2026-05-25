-- CreateFunction
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER "Novel_set_updated_at"
BEFORE UPDATE ON "Novel"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- CreateTrigger
CREATE TRIGGER "Volume_set_updated_at"
BEFORE UPDATE ON "Volume"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- CreateTrigger
CREATE TRIGGER "Chapter_set_updated_at"
BEFORE UPDATE ON "Chapter"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- CreateTrigger
CREATE TRIGGER "AgentThread_set_updated_at"
BEFORE UPDATE ON "AgentThread"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
