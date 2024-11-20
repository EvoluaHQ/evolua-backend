require("../steps/init");
const { handler } = require("../../functions/search-repos");

describe("As an authenticated user", () => {

  it("Emtpy query string should return everything", async () => {
    const event = {
      arguments: {
        query: "",
        count: 1,
        // sortBy: "name",
        // sortDirection: "desc"
      },
      identity: {
        resolverContext: {
          tenantId: '01JBJBS3EBFREP911BJZ6624DV'
        }
      }
    };

    const { repos } = await handler(event, {});
    expect(repos).toHaveLength(1);
  });
});