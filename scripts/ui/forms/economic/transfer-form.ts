/**
 * 转账表单
 * 完整迁移自 Modules/Economic/Transfer/TransferForm.ts (277行)
 */

import { Player, world, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { openDialogForm } from "../../components/dialog";
import economic from "../../../features/economic/services/economic";
import { colorCodes } from "../../../shared/utils/color";

/**
 * 玩家转账系统UI管理类
 */
class TransferForm {
  /**
   * 打开转账主界面
   */
  openTransferMenu(player: Player): void {
    const { openEconomyMenuForm } = require("./index");
    const form = new ActionFormData()
      .title("转账")
      .body(
        `${colorCodes.green}您可以在这里向其他玩家转账金币。\n${colorCodes.yellow}当前余额: ${colorCodes.gold}${
          economic.getWallet(player.name).gold
        } ${colorCodes.yellow}金币`
      )
      .button("开始转账", "textures/icons/shop_bank")
      .button("返回", "textures/icons/back");

    form.show(player).then((response) => {
      if (response.canceled) return;

      switch (response.selection) {
        case 0:
          this.showTransferForm(player);
          break;
        case 1:
          openEconomyMenuForm(player);
          break;
      }
    });
  }

  /**
   * 显示转账表单
   */
  private showTransferForm(player: Player): void {
    const onlinePlayers = world.getPlayers();
    const playerNames = onlinePlayers.filter((p) => p.name !== player.name).map((p) => p.name);

    if (playerNames.length === 0) {
      const form = new ModalFormData()
        .title("转账")
        .textField(`${colorCodes.yellow}请输入接收方玩家名称`, "输入玩家名称", {
          defaultValue: "",
        })
        .textField(`${colorCodes.yellow}请输入转账金额`, "输入金额", {
          defaultValue: "100",
        });

      form.show(player).then((response) => {
        if (response.canceled) {
          this.openTransferMenu(player);
          return;
        }

        const [targetName, amountStr] = response.formValues as [string, string];
        this.processTransfer(player, targetName, amountStr);
      });
    } else {
      const form = new ModalFormData()
        .title("转账")
        .dropdown(`${colorCodes.yellow}选择在线玩家`, ["-- 不选择 --", ...playerNames], {
          defaultValueIndex: 0,
        })
        .textField(`${colorCodes.yellow}或直接输入玩家名称`, "输入玩家名称", {
          defaultValue: "",
        })
        .textField(`${colorCodes.yellow}请输入转账金额`, "输入金额", {
          defaultValue: "100",
        });

      form.show(player).then((response) => {
        if (response.canceled) {
          this.openTransferMenu(player);
          return;
        }

        const [selectedIndex, inputName, amountStr] = response.formValues as [number, string, string];

        let targetName = "";
        if (inputName && inputName.trim() !== "") {
          targetName = inputName.trim();
        } else if (selectedIndex > 0) {
          targetName = playerNames[selectedIndex - 1];
        }

        this.processTransfer(player, targetName, amountStr);
      });
    }
  }

  /**
   * 处理转账逻辑
   */
  private processTransfer(player: Player, targetName: string, amountStr: string): void {
    if (!targetName || targetName.trim() === "") {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}请指定接收方玩家名称`,
        },
        () => this.showTransferForm(player)
      );
      return;
    }

    if (targetName === player.name) {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}不能转账给自己`,
        },
        () => this.showTransferForm(player)
      );
      return;
    }

    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount <= 0) {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}请输入有效的转账金额`,
        },
        () => this.showTransferForm(player)
      );
      return;
    }

    const wallet = economic.getWallet(player.name);
    if (wallet.gold < amount) {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}余额不足，当前余额: ${colorCodes.gold}${wallet.gold} ${colorCodes.red}金币`,
        },
        () => this.showTransferForm(player)
      );
      return;
    }

    const targetWallet = economic.getWallet(targetName);
    if (!targetWallet) {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}玩家 ${colorCodes.yellow}${targetName} ${colorCodes.red}不存在或未注册钱包`,
        },
        () => this.showTransferForm(player)
      );
      return;
    }

    this.showConfirmTransfer(player, targetName, amount);
  }

  /**
   * 显示转账确认表单
   */
  private showConfirmTransfer(player: Player, targetName: string, amount: number): void {
    const form = new ActionFormData()
      .title("确认转账")
      .body(
        `${colorCodes.green}您确定要向 ${colorCodes.yellow}${targetName} ${colorCodes.green}转账 ${colorCodes.gold}${amount} ${colorCodes.green}金币吗？`
      )
      .button("确认转账", "textures/icons/accept")
      .button("取消", "textures/icons/deny");

    form.show(player).then((response) => {
      if (response.canceled || response.selection === 1) {
        this.showTransferForm(player);
        return;
      }

      this.executeTransfer(player, targetName, amount);
    });
  }

  /**
   * 执行转账操作
   */
  private executeTransfer(player: Player, targetName: string, amount: number): void {
    const result = economic.transfer(player.name, targetName, amount, "玩家转账");

    if (typeof result === "string") {
      openDialogForm(
        player,
        {
          title: "转账失败",
          desc: `${colorCodes.red}${result}`,
        },
        () => this.showTransferForm(player)
      );
    } else {
      const successMessage: RawMessage = {
        rawtext: [
          {
            text: `${colorCodes.green}成功向 ${colorCodes.yellow}${targetName} ${colorCodes.green}转账 ${colorCodes.gold}${amount} ${colorCodes.green}金币\n`,
          },
          {
            text: `${colorCodes.green}当前余额: ${colorCodes.gold}${economic.getWallet(player.name).gold} ${
              colorCodes.green
            }金币`,
          },
        ],
      };

      openDialogForm(
        player,
        {
          title: "转账成功",
          desc: successMessage,
        },
        () => this.openTransferMenu(player)
      );

      try {
        const targetPlayer = world.getPlayers().find((p) => p.name === targetName);
        if (targetPlayer) {
          const notificationMessage: RawMessage = {
            rawtext: [
              {
                text: `${colorCodes.green}您收到来自 ${colorCodes.yellow}${player.name} ${colorCodes.green}的转账 ${colorCodes.gold}${amount} ${colorCodes.green}金币\n`,
              },
              {
                text: `${colorCodes.green}当前余额: ${colorCodes.gold}${economic.getWallet(targetName).gold} ${
                  colorCodes.green
                }金币`,
              },
            ],
          };

          targetPlayer.sendMessage(notificationMessage);
        }
      } catch (error) {
        // 通知失败不影响主流程
      }
    }
  }
}

const transferForm = new TransferForm();
export default transferForm;
