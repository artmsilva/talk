import { isNull, omitBy } from "lodash";
import { v4 as uuid } from "uuid";

import { ERROR_CODES } from "coral-common/errors";
import GraphContext from "coral-server/graph/context";
import { mapFieldsetToErrorCodes } from "coral-server/graph/errors";
import {
  generateTreeForStory,
  markStoryForArchiving,
  markStoryForUnarchiving,
  retrieveStory,
  Story,
} from "coral-server/models/story";
import { validateJobData } from "coral-server/queue/tasks/regenerateStoryTrees/processor";
import { archiveStory, unarchiveStory } from "coral-server/services/archive";
import {
  addExpert,
  close,
  create,
  merge,
  open,
  remove,
  removeExpert,
  update,
  updateSettings,
  updateStoryMode,
} from "coral-server/services/stories";
import { scrape } from "coral-server/services/stories/scraper";

import {
  GQLAddStoryExpertInput,
  GQLArchiveStoriesInput,
  GQLCloseStoryInput,
  GQLCreateStoryInput,
  GQLGenerateStoryTreeInput,
  GQLMergeStoriesInput,
  GQLOpenStoryInput,
  GQLRegenerateStoryTreesInput,
  GQLRemoveStoryExpertInput,
  GQLRemoveStoryInput,
  GQLScrapeStoryInput,
  GQLUnarchiveStoriesInput,
  GQLUpdateStoryInput,
  GQLUpdateStoryModeInput,
  GQLUpdateStorySettingsInput,
} from "coral-server/graph/schema/__generated__/types";

import { validateUserModerationScopes } from "./helpers";

export const Stories = (ctx: GraphContext) => ({
  create: async (input: GQLCreateStoryInput): Promise<Readonly<Story> | null> =>
    mapFieldsetToErrorCodes(
      create(
        ctx.mongo,
        ctx.tenant,
        ctx.broker,
        ctx.config,
        input.story.id,
        input.story.url,
        omitBy(input.story, isNull),
        ctx.now
      ),
      {
        "input.story.url": [
          ERROR_CODES.STORY_URL_NOT_PERMITTED,
          ERROR_CODES.DUPLICATE_STORY_URL,
        ],
      }
    ),
  update: async (input: GQLUpdateStoryInput): Promise<Readonly<Story> | null> =>
    mapFieldsetToErrorCodes(
      update(ctx.mongo, ctx.tenant, input.id, input.story, ctx.now),
      {
        "input.story.url": [
          ERROR_CODES.STORY_URL_NOT_PERMITTED,
          ERROR_CODES.DUPLICATE_STORY_URL,
        ],
      }
    ),
  updateSettings: async (
    input: GQLUpdateStorySettingsInput
  ): Promise<Readonly<Story> | null> => {
    // Validate that this user is allowed to edit this story
    await validateUserModerationScopes(ctx, ctx.user!, { storyID: input.id });

    return updateSettings(
      ctx.mongo,
      ctx.tenant,
      input.id,
      input.settings,
      ctx.now
    );
  },
  close: async (input: GQLCloseStoryInput): Promise<Readonly<Story> | null> => {
    // Validate that this user is allowed to close this story
    await validateUserModerationScopes(ctx, ctx.user!, { storyID: input.id });

    return close(ctx.mongo, ctx.tenant, input.id, ctx.now);
  },
  open: async (input: GQLOpenStoryInput): Promise<Readonly<Story> | null> => {
    // Validate that this user is allowed to open this story
    await validateUserModerationScopes(ctx, ctx.user!, { storyID: input.id });

    return open(ctx.mongo, ctx.tenant, input.id, ctx.now);
  },
  merge: async (input: GQLMergeStoriesInput): Promise<Readonly<Story> | null> =>
    merge(ctx.mongo, ctx.tenant, input.destinationID, input.sourceIDs),
  remove: async (input: GQLRemoveStoryInput): Promise<Readonly<Story> | null> =>
    remove(ctx.mongo, ctx.tenant, input.id, input.includeComments),
  scrape: async (input: GQLScrapeStoryInput): Promise<Readonly<Story> | null> =>
    scrape(ctx.mongo, ctx.config, ctx.tenant.id, input.id),
  updateStoryMode: async (input: GQLUpdateStoryModeInput) => {
    // Validate that this user is allowed to update the story mode
    await validateUserModerationScopes(ctx, ctx.user!, {
      storyID: input.storyID,
    });

    return updateStoryMode(ctx.mongo, ctx.tenant, input.storyID, input.mode);
  },
  addStoryExpert: async (input: GQLAddStoryExpertInput) => {
    // Validate that this user is allowed to add a story expert
    await validateUserModerationScopes(ctx, ctx.user!, {
      storyID: input.storyID,
    });

    return addExpert(ctx.mongo, ctx.tenant, input.storyID, input.userID);
  },
  removeStoryExpert: async (input: GQLRemoveStoryExpertInput) => {
    // Validate that this user is allowed to remove a story expert
    await validateUserModerationScopes(ctx, ctx.user!, {
      storyID: input.storyID,
    });

    return removeExpert(ctx.mongo, ctx.tenant, input.storyID, input.userID);
  },
  archiveStories: async (input: GQLArchiveStoriesInput) => {
    const stories: Readonly<Story>[] = [];

    for (const storyID of input.storyIDs) {
      const markResult = await markStoryForArchiving(
        ctx.mongo,
        ctx.tenant.id,
        storyID,
        ctx.now
      );

      if (markResult) {
        await archiveStory(
          ctx.mongo,
          ctx.redis,
          ctx.tenant.id,
          storyID,
          ctx.logger,
          ctx.now
        );
      }

      const result = await retrieveStory(ctx.mongo, ctx.tenant.id, storyID);
      if (result) {
        stories.push(result);
      }
    }

    return stories;
  },
  unarchiveStories: async (input: GQLUnarchiveStoriesInput) => {
    const stories: Readonly<Story>[] = [];

    for (const storyID of input.storyIDs) {
      const markResult = await markStoryForUnarchiving(
        ctx.mongo,
        ctx.tenant.id,
        storyID,
        ctx.now
      );

      if (markResult) {
        await unarchiveStory(
          ctx.mongo,
          ctx.redis,
          ctx.tenant.id,
          storyID,
          ctx.logger,
          ctx.now
        );
      }

      const result = await retrieveStory(ctx.mongo, ctx.tenant.id, storyID);
      if (result) {
        stories.push(result);
      }
    }

    return stories;
  },
  generateStoryTree: async (input: GQLGenerateStoryTreeInput) => {
    await generateTreeForStory(
      ctx.mongo,
      ctx.logger,
      ctx.tenant.id,
      input.storyID
    );
    return { storyID: input.storyID };
  },
  regenerateStoryTrees: async ({
    disableCommenting,
    disableCommentingMessage,
  }: GQLRegenerateStoryTreesInput) => {
    const jobID = uuid();

    const jobData = {
      tenantID: ctx.tenant.id,
      jobID,
      disableCommenting: !!disableCommenting,
      disableCommentingMessage,
    };

    const { success, error } = validateJobData(jobData);
    if (!success || error) {
      ctx.logger.error(
        { err: error, jobData },
        "rejecting regenerateStoryTrees request: validation of job data failed"
      );

      return {
        accepted: false,
        jobID: "",
      };
    }

    await ctx.regenerateStoryTreesQueue.add(jobData);

    return {
      accepted: true,
      jobID,
    };
  },
});
