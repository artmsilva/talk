import GraphContext from "coral-server/graph/context";
import { createIllegalContent } from "coral-server/services/comments";
import { createDSAReport } from "coral-server/services/dsaReports/reports";

import { GQLCreateDSAReportInput } from "coral-server/graph/schema/__generated__/types";

export const DSAReports = (ctx: GraphContext) => ({
  createDSAReport: async ({
    commentID,
    userID,
    lawBrokenDescription,
    additionalInformation,
    submissionID,
    commentRevisionID,
  }: GQLCreateDSAReportInput) => {
    await createDSAReport(ctx.mongo, ctx.tenant, {
      commentID,
      userID,
      lawBrokenDescription,
      additionalInformation,
      submissionID,
    });

    if (ctx.user) {
      await createIllegalContent(
        ctx.mongo,
        ctx.redis,
        ctx.config,
        ctx.cache.commentActions,
        ctx.broker,
        ctx.tenant,
        ctx.user,
        { commentID, commentRevisionID },
        ctx.now
      );
    }
  },
});
