import { Bot } from "grammy";
import { config } from "../config";
import { logger } from "../utils/logger";
import { registerHandlers } from "./handlers";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);
  registerHandlers(bot);

  bot.catch((err) => {
    logger.error("Bot error", err.error);
  });

  return bot;
}

export async function startBot(bot: Bot): Promise<void> {
  logger.info("Starting InfoMaulid Bot (long polling)…");
  await bot.start({
    onStart: (info) => {
      logger.info(`Bot @${info.username} is running`);
    },
  });
}
